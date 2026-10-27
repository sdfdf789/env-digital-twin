/* =========================================================
   map3d.js · 三维中国地图引擎
   - GeoJSON → ExtrudeGeometry 拉伸的三维行政区（数据驱动高度）
   - 监测站光束 / 呼吸光环 / 悬浮粒子 / 深空底座
   - 自研轨道控制器：拖拽旋转 · 滚轮/双指缩放 · 悬停与拾取
   ========================================================= */
(function (global) {
  "use strict";

  const THREE = global.THREE;
  const { PROVINCES, aqiColor } = global.CFG;

  const TARGET_WIDTH = 100;      // 地图在场景中的归一化宽度
  const SOUTH_CUT = 17.0;        // 低于该纬度的南海离岛交由右下角插图表达
  const BASE_DEPTH = 1.6;        // 行政区基础厚度
  const MAX_COLUMN = 6.4;        // 数据柱最大附加高度

  let renderer, scene, camera, root;
  let canvasEl;
  let provinces = [];
  let meshes = [];
  let hovered = null, selected = null;
  let layer = "air";
  let autoRotate = true;
  let clockObj;
  let pulseRings = [];
  let particles;

  // 投影参数（运行时按数据实际范围计算）
  let K = 1.62, LON0 = 104.5, LAT0 = 36, Y0 = 0;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const view = { yaw: -0.42, pitch: 0.74, dist: 132, targetPitch: 0.74, targetDist: 132 };
  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
  const pointer = { x: 0, y: 0 };

  const cb = { onHover: null, onPick: null, onReady: null };

  /* ---------------- 投影 ---------------- */
  function mercY(lat) {
    const r = lat * D2R;
    return Math.log(Math.tan(Math.PI / 4 + r / 2)) * R2D;
  }
  function project(lon, lat) {
    return [(lon - LON0) * K, (mercY(lat) - Y0) * K];   // 北向为 +y（旋转后映射为世界 -Z）
  }

  function computeProjection(geo) {
    let lonMin = 180, lonMax = -180, latMin = 90, latMax = -90;
    geo.features.forEach((f) => {
      if (!f.properties || !f.properties.name) return; // 跳过九段线要素
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      polys.forEach((poly) => {
        poly.forEach((ring) => ring.forEach((c) => {
          const lon = c[0], lat = Math.max(SOUTH_CUT, c[1]);
          if (lon < lonMin) lonMin = lon;
          if (lon > lonMax) lonMax = lon;
          if (lat < latMin) latMin = lat;
          if (lat > latMax) latMax = lat;
        }));
      });
    });
    LON0 = (lonMin + lonMax) / 2;
    LAT0 = (latMin + latMax) / 2;
    Y0 = mercY(LAT0);
    K = TARGET_WIDTH / Math.max(1, lonMax - lonMin);
    return { lonMin, lonMax, latMin, latMax, width: TARGET_WIDTH, height: (mercY(latMax) - mercY(latMin)) * K };
  }

  /* ---------------- 环处理 ---------------- */
  function simplify(ring, eps) {
    const out = [];
    let lastX = Infinity, lastY = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = project(ring[i][0], ring[i][1]);
      if (i === 0 || i === ring.length - 1 ||
          Math.abs(p[0] - lastX) + Math.abs(p[1] - lastY) >= eps) {
        out.push(p); lastX = p[0]; lastY = p[1];
      }
    }
    return out;
  }

  /* ---------------- 几何构建 ---------------- */
  function buildProvince(feature) {
    const polys = feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

    const shapes = [];
    const outlinePts = [];

    polys.forEach((poly) => {
      const ring = poly[0];
      if (!ring || ring.length < 4) return;

      let latSum = 0, lonMax = -180;
      ring.forEach((c) => { latSum += c[1]; if (c[0] > lonMax) lonMax = c[0]; });
      const latAvg = latSum / ring.length;
      if (latAvg < SOUTH_CUT && lonMax < 118) return;

      const pts = simplify(ring, 0.055);
      if (pts.length > 1 &&
          Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-6 &&
          Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
      if (pts.length < 3) return;

      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();

      for (let h = 1; h < poly.length; h++) {
        const hpts = simplify(poly[h], 0.06);
        if (hpts.length < 3) continue;
        const hole = new THREE.Path();
        hole.moveTo(hpts[0][0], hpts[0][1]);
        for (let i = 1; i < hpts.length; i++) hole.lineTo(hpts[i][0], hpts[i][1]);
        hole.closePath();
        shape.holes.push(hole);
      }
      shapes.push(shape);
      outlinePts.push(pts);
    });

    if (!shapes.length) return null;

    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: BASE_DEPTH, bevelEnabled: true,
      bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1, curveSegments: 1
    });
    geo.computeVertexNormals();
    return { geo, outlinePts };
  }

  /* ---------------- 纹理 ---------------- */
  function radialTexture(inner, outer) {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  function gridTexture() {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.strokeStyle = "rgba(64,190,255,0.6)";
    ctx.lineWidth = 1;
    const step = size / 20;
    for (let i = 0; i <= 20; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
    }
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.65, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ---------------- 初始化 ---------------- */
  function initScene() {
    clockObj = new THREE.Clock();
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03080f, 0.0042);

    const w = canvasEl.clientWidth || 900;
    const h = canvasEl.clientHeight || 600;
    camera = new THREE.PerspectiveCamera(38, w / h, 0.5, 900);

    renderer = new THREE.WebGLRenderer({
      canvas: canvasEl, antialias: true, alpha: true, powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.AmbientLight(0x3d5c82, 0.85));
    const dir = new THREE.DirectionalLight(0xcfeaff, 0.78);
    dir.position.set(-50, 110, 70);
    scene.add(dir);
    const p1 = new THREE.PointLight(0x35d6ff, 0.95, 320);
    p1.position.set(0, 42, 10);
    scene.add(p1);
    const p2 = new THREE.PointLight(0x1c6bff, 0.85, 420);
    p2.position.set(-80, 20, -70);
    scene.add(p2);
    const hemi = new THREE.HemisphereLight(0x9fd8ff, 0x08141f, 0.65);
    scene.add(hemi);
    const dir2 = new THREE.DirectionalLight(0x7fd4ff, 0.42);
    dir2.position.set(70, 60, -55);
    scene.add(dir2);

    root = new THREE.Group();
    scene.add(root);

    buildBase();
    bindEvents();
    animate();
  }

  function buildBase() {
    const gridGeo = new THREE.PlaneGeometry(176, 176);
    const grid = new THREE.Mesh(gridGeo, new THREE.MeshBasicMaterial({
      map: gridTexture(), transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -2.4;
    root.add(grid);

    const glowTex = radialTexture("rgba(53,214,255,0.5)", "rgba(28,107,255,0.2)");
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(150, 150, 1);
    glow.position.y = -2.2;
    root.add(glow);

    [58, 70, 82].forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.22, 160),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0x35d6ff : 0x1c6bff, transparent: true, opacity: 0.34,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -2.3;
      root.add(ring);
      pulseRings.push({ mesh: ring, phase: i * 0.9 });
    });

    const count = 280;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 170;
      pos[i * 3 + 1] = Math.random() * 40 - 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0x7ff0ff, size: 0.9, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false
    }));
    root.add(particles);
  }

  /* ---------------- 构建行政区 ---------------- */
  function buildProvinces(geo) {
    const stationTex = radialTexture("rgba(235,253,255,1)", "rgba(53,214,255,0.5)");
    let built = 0;

    geo.features.forEach((f) => {
      const full = (f.properties && f.properties.name) || "";
      if (!full) return;
      const cfg = PROVINCES.find((p) => p.full === full || p.name === full);
      const short = cfg ? cfg.name : full.replace(/(省|市|自治区|特别行政区)/g, "");

      const built2 = buildProvince(f);
      if (!built2) return;

      const mat = new THREE.MeshPhongMaterial({
        color: 0x0b3a63,
        emissive: 0x0f4066,
        emissiveIntensity: 0.95,
        specular: 0x9fe8ff,
        shininess: 48
      });
      const mesh = new THREE.Mesh(built2.geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData = { name: short, full, baseH: BASE_DEPTH };

      // 顶面轮廓光带（随父级旋转与高度缩放，天然贴合顶面）
      const linePts = [];
      built2.outlinePts.forEach((pts) => {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          linePts.push(a[0], a[1], BASE_DEPTH + 0.04, b[0], b[1], BASE_DEPTH + 0.04);
        }
      });
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePts, 3));
      const outline = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: 0x7ff0ff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      mesh.add(outline);

      root.add(mesh);

      // 监测站点
      const pos = cfg ? project(cfg.lon, cfg.lat) : [0, 0];
      const station = new THREE.Group();
      station.position.set(pos[0], BASE_DEPTH, -pos[1]);

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: stationTex, transparent: true, opacity: 0.9, color: 0xffffff,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      sprite.scale.set(2.0, 2.0, 1);
      station.add(sprite);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.26, 3.6, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x35d6ff, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
        })
      );
      beam.position.y = 1.8;
      station.add(beam);

      const baseRing = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.82, 26),
        new THREE.MeshBasicMaterial({
          color: 0x35d6ff, transparent: true, opacity: 0.75,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
        })
      );
      baseRing.rotation.x = -Math.PI / 2;
      baseRing.position.y = 0.06;
      station.add(baseRing);

      root.add(station);
      meshes.push(mesh);
      provinces.push({
        name: short, mesh, outline, station, sprite, beam, baseRing,
        data: null, phase: Math.random() * 6.28
      });
      built++;
    });
    return built;
  }

  /* ---------------- 数据驱动外观 ---------------- */
  function layerFactor(d) {
    if (!d) return 0.12;
    if (layer === "air") return Math.min(1, d.aqi / 220);
    if (layer === "water") {
      const idx = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "劣Ⅴ"].indexOf(d.water);
      return Math.min(1, Math.max(0.05, (5 - idx) / 5));
    }
    return Math.min(1, (d.density || 40) / 100);
  }

  function layerColor(d) {
    if (!d) return "#12507f";
    if (layer === "air") return aqiColor(d.aqi);
    if (layer === "water") return d.waterColor;
    const t = Math.min(1, (d.density || 40) / 100);
    return t > 0.85 ? "#c026d3" : t > 0.7 ? "#ff4d6d" : t > 0.55 ? "#ffb454" : t > 0.35 ? "#35d6ff" : "#1ee6c2";
  }

  function updateProvinces(list, curLayer) {
    if (curLayer) layer = curLayer;
    const map = {};
    (list || []).forEach((d) => { map[d.name] = d; });

    provinces.forEach((p) => {
      const d = map[p.name] || null;
      p.data = d;
      const col = new THREE.Color(layerColor(d));
      const hsl = {};
      col.getHSL(hsl);
      col.setHSL(hsl.h, Math.min(1, hsl.s * 1.3), Math.min(0.55, hsl.l));
      const mat = p.mesh.material;
      mat.color.copy(col).multiplyScalar(0.5).lerp(new THREE.Color(0x061a2e), 0.26);
      mat.emissive.copy(col).multiplyScalar(0.24);
      mat.emissiveIntensity = 0.6;

      const factor = layerFactor(d);
      const h = BASE_DEPTH + 0.15 + factor * MAX_COLUMN;
      p.mesh.scale.z = h / BASE_DEPTH;   // 本地 Z 为高度方向
      p.mesh.userData.baseH = h;

      if (p.station) {
        p.station.position.y = h;
        const showBeam = layer === "air" && d && d.aqi > 150;   // 仅重污染省份点亮光柱
        p.beam.visible = !!showBeam;
        p.beam.scale.y = 0.55 + factor * 0.8;
        p.beam.position.y = (3.6 * p.beam.scale.y) / 2;
        p.beam.material.color.copy(col);
        p.sprite.material.color = new THREE.Color(0xffffff).lerp(col, 0.75);
        p.sprite.scale.setScalar(1.7 + factor * 1.2);
        p.baseRing.material.color.copy(col);
        p.baseRing.scale.setScalar(0.8 + factor * 0.5);
        p.outline.material.color.copy(col).lerp(new THREE.Color(0xffffff), 0.5);
      }
    });
    applySelection();
  }

  function applySelection() {
    provinces.forEach((p) => {
      const isSel = selected === p.name;
      const isHov = hovered === p.name;
      p.mesh.material.emissiveIntensity = isSel ? 2.2 : isHov ? 1.6 : 0.95;
      p.outline.material.opacity = isSel ? 1 : isHov ? 0.8 : 0.34;
    });
  }

  /* ---------------- 交互 ---------------- */
  const raycaster = new THREE.Raycaster();
  const pointerVec = new THREE.Vector2();

  function bindEvents() {
    canvasEl.addEventListener("pointerdown", (e) => {
      dragging = true; dragMoved = false;
      lastX = e.clientX; lastY = e.clientY;
      canvasEl.style.cursor = "grabbing";
    });

    canvasEl.addEventListener("pointermove", (e) => {
      const rect = canvasEl.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;

      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        view.yaw -= dx * 0.0045;
        view.targetPitch = Math.max(0.2, Math.min(1.34, view.targetPitch + dy * 0.0035));
        lastX = e.clientX; lastY = e.clientY;
        if (autoRotate) { autoRotate = false; document.dispatchEvent(new CustomEvent("map3d:autorotate", { detail: false })); }
      } else {
        hoverPick(e);
      }
    });

    canvasEl.addEventListener("pointerup", (e) => {
      dragging = false;
      canvasEl.style.cursor = "grab";
      if (!dragMoved) {
        const hit = pickName(e);
        selected = hit;
        applySelection();
        cb.onPick && cb.onPick(selected);
      }
    });

    canvasEl.addEventListener("pointerleave", () => {
      if (hovered) { hovered = null; applySelection(); cb.onHover && cb.onHover(null); }
      canvasEl.style.cursor = "default";
    });

    canvasEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      view.targetDist = Math.max(50, Math.min(215, view.targetDist * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });

    let pinch = null;
    canvasEl.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinch = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    canvasEl.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && pinch) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        view.targetDist = Math.max(50, Math.min(215, view.targetDist * (pinch / d)));
        pinch = d;
      }
    }, { passive: true });
    canvasEl.addEventListener("touchend", () => { pinch = null; });
  }

  function pickName(e) {
    if (!meshes.length) return null;
    const rect = canvasEl.getBoundingClientRect();
    pointerVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerVec, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.name : null;
  }

  let lastHoverAt = 0;
  function hoverPick(e) {
    const now = performance.now();
    if (now - lastHoverAt < 40) {
      if (hovered && cb.onHover) cb.onHover(hovered, { x: pointer.x, y: pointer.y });
      return;
    }
    lastHoverAt = now;
    const name = pickName(e);
    canvasEl.style.cursor = name ? "pointer" : "grab";
    if (name !== hovered) {
      hovered = name;
      applySelection();
      cb.onHover && cb.onHover(name, { x: pointer.x, y: pointer.y });
    } else if (name) {
      cb.onHover && cb.onHover(name, { x: pointer.x, y: pointer.y });
    }
  }

  /* ---------------- 渲染循环 ---------------- */
  function animate() {
    requestAnimationFrame(animate);
    const t = clockObj.getElapsedTime();

    if (autoRotate && !dragging) view.yaw += 0.0015;

    view.pitch += (view.targetPitch - view.pitch) * 0.09;
    view.dist += (view.targetDist - view.dist) * 0.09;

    const cy = Math.sin(view.pitch) * view.dist;
    const cr = Math.cos(view.pitch) * view.dist;
    camera.position.set(Math.sin(view.yaw) * cr, cy, Math.cos(view.yaw) * cr);
    camera.lookAt(0, 5, 0);

    for (let i = 0; i < provinces.length; i++) {
      const p = provinces[i];
      if (!p.station) continue;
      const pulse = 1 + Math.sin(t * 1.8 + p.phase) * 0.18;
      p.baseRing.scale.setScalar(
        (0.8 + Math.min(1, layerFactor(p.data)) * 0.5) * pulse
      );
      p.baseRing.material.opacity = 0.5 + Math.sin(t * 2.2 + p.phase) * 0.28;
      p.sprite.material.opacity = 0.72 + Math.sin(t * 2.8 + p.phase) * 0.24;
    }

    pulseRings.forEach((r) => {
      const s = 1 + Math.sin(t * 0.5 + r.phase) * 0.03;
      r.mesh.scale.set(s, s, 1);
      r.mesh.material.opacity = 0.16 + Math.sin(t * 0.65 + r.phase) * 0.09;
    });

    if (particles) {
      const arr = particles.geometry.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += 0.03;
        if (arr[i] > 40) arr[i] = -2;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      particles.rotation.y = t * 0.01;
    }

    renderer.render(scene, camera);
  }

  function resize() {
    if (!renderer) return;
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  }

  function fitDistance() {
    const w = canvasEl ? canvasEl.clientWidth || 900 : 900;
    const h = canvasEl ? canvasEl.clientHeight || 600 : 600;
    const aspect = w / h;
    const needW = 108;
    const fovRad = (38 * D2R) / 2;
    const distForWidth = (needW / 2) / (Math.tan(fovRad) * Math.max(0.5, aspect));
    return Math.max(78, Math.min(200, distForWidth));
  }

  /* ---------------- 对外 API ---------------- */
  global.Map3D = {
    init(geo, callbacks) {
      canvasEl = document.getElementById("map3d");
      Object.assign(cb, callbacks || {});
      computeProjection(geo);
      initScene();
      const n = buildProvinces(geo);
      view.dist = view.targetDist = fitDistance();
      resize();
      if (global.ResizeObserver) new ResizeObserver(() => resize()).observe(canvasEl);
      global.addEventListener("resize", resize);
      cb.onReady && cb.onReady(n);
      return n;
    },
    update(list, curLayer) { updateProvinces(list, curLayer); },
    setLayer(l) {
      layer = l;
      updateProvinces((global.DS && global.DS.state.provinces) || [], l);
    },
    select(n) { selected = n; applySelection(); },
    getSelected() { return selected; },
    setAutoRotate(v) { autoRotate = !!v; return autoRotate; },
    toggleAutoRotate() { autoRotate = !autoRotate; return autoRotate; },
    zoom(dir) { view.targetDist = Math.max(50, Math.min(215, view.targetDist * (dir > 0 ? 0.85 : 1.18))); },
    reset() {
      view.yaw = -0.42; view.pitch = view.targetPitch = 0.74;
      view.dist = view.targetDist = fitDistance();
      selected = null; hovered = null; applySelection();
    },
    resize,
    setView(v) {
      if (v.yaw != null) view.yaw = v.yaw;
      if (v.pitch != null) view.pitch = view.targetPitch = v.pitch;
      if (v.dist != null) view.dist = view.targetDist = v.dist;
      if (v.autoRotate != null) autoRotate = !!v.autoRotate;
    },
    stats() { return { provinces: provinces.length, meshes: meshes.length, layer, autoRotate, K }; }
  };
})(window);
