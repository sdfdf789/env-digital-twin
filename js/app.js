/* =========================================================
   app.js · 交互编排层
   串联：引导加载 → 三维地图 → 数据订阅 → 面板渲染 → 状态处理
   ========================================================= */
(function (global) {
  "use strict";

  const { PROVINCES, AQI_LEVELS, POLLUTANT_META, aqiLevel, aqiColor, fmtTime } = global.CFG;
  const $ = (id) => document.getElementById(id);

  let geo = null;
  let selected = null;
  let layer = "air";
  let rankDir = "worst";
  let booted = false;
  let lastData = null;

  /* ---------------- 引导 ---------------- */
  const bootSteps = [
    { p: 12, text: "正在装载图表渲染引擎…" },
    { p: 38, text: "正在读取省级行政区划边界…" },
    { p: 68, text: "正在构建三维地形网格…" },
    { p: 88, text: "正在校验地图合规要素…" },
    { p: 100, text: "场景就绪，接入实时监测数据…" }
  ];

  function setBoot(i) {
    const s = bootSteps[Math.min(i, bootSteps.length - 1)];
    $("bootBar").style.width = s.p + "%";
    $("bootStep").textContent = s.text;
  }

  function bootFail(msg) {
    $("bootStep").innerHTML = '<span style="color:#ff5d7a">' + msg + '</span>　<button id="bootRetry" style="font:inherit;font-size:11px;padding:1px 10px;background:rgba(255,93,122,.15);border:1px solid #ff5d7a;color:#ffc3cf;cursor:pointer">重新加载</button>';
    const btn = $("bootRetry");
    if (btn) btn.onclick = () => location.reload();
  }

  async function boot() {
    Charts.init();
    Charts.empty("chartRadar", "等待实时数据…");
    Charts.empty("chartRank", "等待实时数据…");
    Charts.empty("chartTrend", "等待实时数据…");
    setBoot(0);

    try {
      setBoot(1);
      geo = await DS.loadGeo();
    } catch (e) {
      bootFail("地图底数加载失败：" + (e.message || "网络异常") + "（请确认通过 http 服务访问，且 data/china.json 可用）");
      return;
    }

    try {
      setBoot(2);
      const n = Map3D.init(geo, {
        onHover: showTooltip,
        onPick: onPickProvince,
        onReady: () => {}
      });
      document.dispatchEvent(new CustomEvent("map3d:ready", { detail: n }));
      setBoot(3);
      try { Charts.initInset(geo); } catch (e) { console.warn("插图初始化失败", e); }
      setBoot(4);
    } catch (e) {
      console.error(e);
      bootFail("三维场景初始化失败：" + (e.message || "WebGL 不可用"));
      return;
    }

    // 完成引导
    setTimeout(() => {
      $("boot").classList.add("hide");
      $("app").classList.add("ready");
      $("app").setAttribute("aria-hidden", "false");
      booted = true;
      startData();
    }, 420);
  }

  /* ---------------- 数据启动 ---------------- */
  async function startData() {
    renderHealth();
    Charts.updateGauge(null);
    DS.start().then(() => {
      $("mapLoader").classList.add("hide");
    });
    // 安全兜底：10 秒内未拿到数据则隐藏 loader 并提示
    setTimeout(() => {
      if (!lastData) {
        $("mapLoader").classList.add("hide");
        showBanner("warn", "实时数据尚未就绪，正在重试；当前展示等待状态。");
      }
    }, 10000);
  }

  /* ---------------- 事件订阅 ---------------- */
  DS.on("data", (st) => {
    lastData = st;
    $("mapLoader").classList.add("hide");
    Map3D.update(st.provinces, layer);
    renderAll(st);
    if (st.mode === "sim") {
      showBanner("err", "实时接口不可用，已切换本地推演数据（标记为「推演」），系统按指数退避自动重试。");
      markSim(true);
    } else {
      hideBanner();
      markSim(false);
      if (DS.state.trend && DS.state.trend.simulated) markSim(true, "pTrend");
    }
  });

  DS.on("trend", (t) => {
    if (t.simulated) markSim(true, "pTrend");
    if (selected) return;              // 已下钻时保留单省序列，避免被全国均值覆盖
    Charts.updateTrend(t, "全国均值");
  });

  DS.on("weather", () => updateTicker());

  DS.on("runner", () => renderHealth());

  DS.on("tick", () => {
    renderPills();
    updateTimers();
  });

  DS.on("error", (e) => {
    const map = { air: "空气质量接口", trend: "趋势接口", weather: "气象接口" };
    toast((map[e.key] || e.key) + "请求失败：" + e.message + "，将在 " + Math.round(e.nextIn / 1000) + "s 后重试", "err");
  });

  DS.on("degraded", (d) => {
    toast("已降级：" + d.message, "warn");
  });

  DS.on("select", (name) => { selected = name; renderAll(DS.state); });

  /* ---------------- 渲染总入口 ---------------- */
  function renderAll(st) {
    const nat = st.national;
    if (!nat) return;

    // 顶部仪表
    Charts.updateGauge(nat);
    $("aqiValue").textContent = nat.aqi;
    $("aqiGrade").textContent = nat.grade;
    $("aqiGrade").style.color = nat.color;
    $("aqiPrimary").textContent = nat.worst ? nat.worst.primary : "—";
    $("aqiSites").textContent = nat.stations + " 个";
    $("aqiGood").textContent = nat.goodCount + " / " + nat.total;
    $("aqiHour").textContent = st.sourceTime ? st.sourceTime.replace("T", " ").slice(5, 16) : fmtTime(Date.now());

    // 雷达（全国或选中省）
    const target = selected && st.byName[selected] ? st.byName[selected] : null;
    Charts.updateRadar(
      target ? { pm2_5: target.pm2_5, pm10: target.pm10, o3: target.o3, no2: target.no2, so2: target.so2, co: target.co } : {
        pm2_5: nat.pm25, pm10: nat.pm10, o3: nat.o3, no2: nat.no2, so2: nat.so2, co: nat.co
      },
      target ? target.name : "全国省会均值"
    );
    $("radarScope").textContent = target ? target.name + " 省会" : "全国省会均值";

    // 排名
    Charts.updateRank(st.provinces, rankDir);

    // 水质
    Charts.updateWater(st.water);

    // 污染源
    Charts.updateSource(st.sourceMix);

    // KPI
    renderKpi(st);

    // 省份卡片
    renderProvinceCard(st, target);

    // 预警
    renderAlarms(st);

    // 播报
    updateTicker();

    // 图例
    renderLegend();
  }

  /* ---------------- KPI ---------------- */
  function renderKpi(st) {
    const nat = st.national;
    const trend = st.trend;
    const items = [
      { label: "监测城市", val: nat.stations, unit: "座", delta: "省会 / 特别行政区" },
      { label: "全国平均 AQI", val: nat.aqi, unit: "", delta: nat.grade, color: nat.color },
      { label: "城市优良率", val: nat.goodRate.toFixed(1), unit: "%", delta: nat.goodCount + "/" + nat.total + " 城市" },
      { label: "水质优良断面", val: st.water.goodRate.toFixed(1), unit: "%", delta: "Ⅰ~Ⅲ 类" },
      { label: "活跃预警", val: (st.alarms || []).filter((a) => a.level >= 2).length, unit: "条", delta: "AQI>100" }
    ];
    const spark = trend ? trend.pm25 : [];
    $("kpiStrip").innerHTML = items.map((it, i) => `
      <div class="kpi">
        <span class="kpi-label">${it.label}</span>
        <span class="kpi-val" ${it.color ? 'style="color:' + it.color + '"' : ""}>${it.val}<small>${it.unit || ""}</small></span>
        <span class="kpi-delta flat">${it.delta || ""}</span>
        ${i < 4 ? sparkline(spark, i) : ""}
      </div>`).join("");
  }

  function sparkline(arr, seed) {
    if (!arr || arr.length < 3) return "";
    const w = 74, h = 34;
    const vals = arr.filter((v) => v != null);
    if (!vals.length) return "";
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 8);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    const colors = ["#35d6ff", "#7ff0ff", "#2ee6b0", "#4a8cff"];
    const c = colors[seed % colors.length];
    return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.2" opacity=".8"/>
      <polygon points="0,${h} ${pts} ${w},${h}" fill="${c}" opacity=".10"/>
    </svg>`;
  }

  /* ---------------- 省份卡片 ---------------- */
  function renderProvinceCard(st, target) {
    const nat = st.national;
    const nameEl = $("pcName"), badgeEl = $("pcBadge");
    if (target) {
      nameEl.textContent = target.name;
      badgeEl.textContent = target.region.toUpperCase() + " · " + target.basin;
      $("pcAqi").textContent = target.aqi;
      $("pcAqi").style.color = target.color;
      $("pcPm25").textContent = target.pm2_5 == null ? "--" : target.pm2_5;
      $("pcWater").textContent = target.water + " 类";
      $("pcWater").style.color = target.waterColor;
      $("pcL4").textContent = "首要污染物";
      $("pcGood").textContent = target.primary;
      $("pcGood").style.fontSize = "13px";
      $("pcFoot").textContent = `监测点 lon ${target.lon.toFixed(2)} / lat ${target.lat.toFixed(2)} · ${target.imputed ? "该点位数据缺失，已推演补齐" : "数据来自实时接口"}`;
    } else {
      nameEl.textContent = "全国";
      badgeEl.textContent = "NATIONAL";
      $("pcAqi").textContent = nat.aqi;
      $("pcAqi").style.color = nat.color;
      $("pcPm25").textContent = nat.pm25;
      $("pcWater").textContent = "Ⅰ~Ⅲ " + st.water.goodRate + "%";
      $("pcWater").style.color = "#7ff0ff";
      $("pcL4").textContent = "优良率";
      $("pcGood").textContent = nat.goodRate + "%";
      $("pcGood").style.fontSize = "15px";
      $("pcFoot").textContent = `覆盖 ${nat.total} 个省会/特别行政区监测点 · ${st.mode === "live" ? "实时接口" : "本地推演"}`;
    }
  }

  /* ---------------- 预警 ---------------- */
  function renderAlarms(st) {
    const list = st.alarms || [];
    $("alarmCount").textContent = list.length + " 条";
    $("alarmList").innerHTML = list.length
      ? list.map((a) => `
        <li class="alarm-item lv-${a.level}">
          <span class="alarm-time">${a.time}</span>
          <div class="alarm-body"><b>${a.title}</b><p>${a.desc}</p></div>
        </li>`).join("")
      : '<li class="alarm-empty">暂无预警事件，系统巡检中…</li>';
  }

  /* ---------------- 数据源健康度 ---------------- */
  const STATUS_TEXT = { idle: "待启动", loading: "拉取中", ok: "在线", warn: "部分可用", error: "失败" };

  function renderHealth() {
    const wrap = $("healthList");
    if (!wrap) return;
    const keys = ["air", "trend", "weather", "water", "source"];
    wrap.innerHTML = keys.map((k) => {
      const r = DS.runners[k];
      const left = Math.max(0, r.nextAt - Date.now());
      const sec = Math.ceil(left / 1000);
      const pct = r.nextAt ? Math.max(0, Math.min(100, 100 - (left / r.cfg.interval) * 100)) : 0;
      const nature = r.cfg.nature === "live" ? "实时" : "基线";
      const next = sec > 3600 ? (sec / 3600).toFixed(1) + "h" : sec >= 60 ? Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") : sec + "s";
      const dot = r.status === "ok" ? "" : r.status === "warn" ? "warn" : r.status === "error" ? "err" : "idle";
      return `<li class="health-item" title="${r.cfg.vendor}">
        <span class="hi-name"><i class="${dot}"></i>${r.cfg.label}</span>
        <span class="hi-meta">${STATUS_TEXT[r.status] || r.status} · ${nature}${r.latency ? " · " + r.latency + "ms" : ""} · <b data-k="${k}">${next}</b></span>
        <span class="hi-bar"><i data-k="${k}" style="width:${pct}%"></i></span>
      </li>`;
    }).join("");
  }

  /** 每秒只刷新倒计时与进度，避免整表重绘 */
  function updateTimers() {
    const pad = (n) => String(n).padStart(2, "0");
    ["air", "trend", "weather", "water", "source"].forEach((k) => {
      const r = DS.runners[k];
      const left = Math.max(0, r.nextAt - Date.now());
      const sec = Math.ceil(left / 1000);
      const txt = sec > 3600 ? (sec / 3600).toFixed(1) + "h" : sec >= 60 ? Math.floor(sec / 60) + ":" + pad(sec % 60) : sec + "s";
      const b = document.querySelector(`#healthList .hi-meta b[data-k="${k}"]`);
      if (b) b.textContent = txt;
      const bar = document.querySelector(`#healthList .hi-bar i[data-k="${k}"]`);
      if (bar && r.nextAt) bar.style.width = Math.max(0, Math.min(100, 100 - (left / r.cfg.interval) * 100)) + "%";
    });
  }

  function renderPills() {
    const air = DS.runners.air;
    const pill = $("pillAir");
    pill.className = "sys-pill" + (air.status === "error" ? " err" : air.status === "warn" ? " warn" : "");
    pill.querySelector("b").textContent =
      air.status === "ok" ? "在线 " + (air.latency || 0) + "ms" :
      air.status === "loading" ? "同步中…" :
      air.status === "error" ? "失败·退避中" : "待启动";

    const left = Math.max(0, air.nextAt - Date.now());
    const sec = Math.ceil(left / 1000);
    $("pillSync").querySelector("b").textContent = left > 0
      ? (sec >= 60 ? Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") : sec + "s")
      : "即将刷新";
  }

  /* ---------------- 图例 ---------------- */
  function renderLegend() {
    const box = $("legendItems");
    if (!box) return;
    if (layer === "air") {
      box.innerHTML = AQI_LEVELS.map((l, i) => {
        const from = i === 0 ? 0 : AQI_LEVELS[i - 1].max + 1;
        const to = l.max === Infinity ? "500+" : l.max;
        return `<div><i style="background:${l.color};box-shadow:0 0 6px ${l.color}"></i>${l.label}<span>${from}–${to}</span></div>`;
      }).join("");
      $("layerDesc").textContent = "按省会城市 AQI 分级着色 · 柱高表征污染程度";
      $("legendTitle").textContent = "AQI 分级";
    } else if (layer === "water") {
      box.innerHTML = global.CFG.WATER_LEVELS.map((w) =>
        `<div><i style="background:${w.color};box-shadow:0 0 6px ${w.color}"></i>${w.key} 类<span>${w.drinkable ? "可饮用" : "需治理"}</span></div>`
      ).join("");
      $("layerDesc").textContent = "按流域断面水质类别着色 · 柱高表征水质优劣";
      $("legendTitle").textContent = "水质类别";
    } else {
      box.innerHTML = ["#c026d3", "#ff4d6d", "#ffb454", "#35d6ff", "#1ee6c2"].map((c, i) =>
        `<div><i style="background:${c};box-shadow:0 0 6px ${c}"></i>密度 ${["80-100", "70-80", "55-70", "35-55", "0-35"][i]}<span>${["极高", "高", "中", "较低", "低"][i]}</span></div>`
      ).join("");
      $("layerDesc").textContent = "污染源密度指数（工业+移动源聚合）";
      $("legendTitle").textContent = "密度指数";
    }
  }

  /* ---------------- 地图提示 ---------------- */
  function showTooltip(name, pos) {
    const tip = $("mapTooltip");
    if (!name) { tip.classList.remove("show"); return; }
    const d = DS.state.byName[name];
    if (!d) return;
    const rows = layer === "water"
      ? [["水质类别", d.water + " 类"], ["流域", d.basin], ["AQI", d.aqi]]
      : layer === "source"
        ? [["密度指数", d.density], ["AQI", d.aqi], ["首要物", d.primary]]
        : [["AQI", d.aqi + " · " + d.grade], ["PM2.5", d.pm2_5 + " μg/m³"], ["水质", d.water + " 类"]];
    tip.innerHTML = `<h4>${d.name}</h4><dl>${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>`;
    tip.style.left = pos.x + "px";
    tip.style.top = pos.y + "px";
    tip.classList.add("show");
  }

  /* ---------------- 交互 ---------------- */
  function onPickProvince(name) {
    selected = name;
    DS.select(name);
    Map3D.select(name);
    const tab = $("tabProvince");
    tab.disabled = !name;
    tab.classList.toggle("active", !!name);
    document.querySelector('.tb-tab[data-scope="national"]').classList.toggle("active", !name);
    if (name) tab.textContent = name + " 聚焦";
    else tab.textContent = "省域聚焦";
    loadTrendFor(name);
  }

  /** 选中省份时拉取该省会 24h 序列；未选中回到全国均值 */
  function loadTrendFor(name) {
    if (!name) {
      if (DS.state.trend) Charts.updateTrend(DS.state.trend, "全国均值");
      return;
    }
    if (DS.state.trend) Charts.updateTrend(DS.state.trend, name + " 省会（载入中）");
    DS.trendFor(name)
      .then((t) => Charts.updateTrend(t, name + " 省会"))
      .catch(() => {
        Charts.updateTrend(DS.state.trend, "全国均值");
        toast(name + " 时序拉取失败，已回退全国均值", "warn");
      });
  }

  function bindUI() {
    // 图层
    $("layerChips").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      layer = btn.dataset.layer;
      $("layerChips").querySelectorAll(".chip").forEach((b) => b.classList.toggle("active", b === btn));
      Map3D.setLayer(layer);
      renderLegend();
      $("mapTooltip").classList.remove("show");
      if (DS.state.national) renderAll(DS.state);
    });

    // 排名切换
    $("rankSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      rankDir = btn.dataset.dir;
      $("rankSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      if (DS.state.provinces.length) Charts.updateRank(DS.state.provinces, rankDir);
    });

    // 刷新
    $("btnRefresh").addEventListener("click", async () => {
      const btn = $("btnRefresh");
      btn.classList.add("spinning");
      toast("正在重新拉取实时数据…", "ok");
      await DS.refresh();
      btn.classList.remove("spinning");
    });

    // 全屏
    $("btnFullscreen").addEventListener("click", () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    });

    // 地图工具
    $("btnAutoRotate").addEventListener("click", () => {
      const on = Map3D.toggleAutoRotate();
      $("btnAutoRotate").classList.toggle("active", on);
    });
    document.addEventListener("map3d:autorotate", (e) => {
      $("btnAutoRotate").classList.toggle("active", !!e.detail);
    });
    $("btnReset").addEventListener("click", () => {
      Map3D.reset();
      selected = null;
      DS.select(null);
      $("tabProvince").disabled = true;
      $("tabProvince").classList.remove("active");
      $("tabProvince").textContent = "省域聚焦";
      document.querySelector('.tb-tab[data-scope="national"]').classList.add("active");
      if (DS.state.national) renderAll(DS.state);
    });
    $("btnZoomIn").addEventListener("click", () => Map3D.zoom(1));
    $("btnZoomOut").addEventListener("click", () => Map3D.zoom(-1));

    // 顶部 tab
    document.querySelector('.tb-tab[data-scope="national"]').addEventListener("click", () => {
      Map3D.reset();
      selected = null;
      DS.select(null);
      $("tabProvince").disabled = true;
      $("tabProvince").classList.remove("active");
      document.querySelector('.tb-tab[data-scope="national"]').classList.add("active");
      if (DS.state.national) renderAll(DS.state);
    });
    $("tabProvince").addEventListener("click", () => {
      if (selected) Map3D.zoom(1);
    });

    // 数据源弹窗
    const openModal = () => { $("modalSource").hidden = false; };
    $("btnSource").addEventListener("click", openModal);
    $("btnHealthInfo").addEventListener("click", openModal);
    $("modalClose").addEventListener("click", () => ($("modalSource").hidden = true));
    $("modalSource").querySelector(".modal-mask").addEventListener("click", () => ($("modalSource").hidden = true));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modalSource").hidden = true; });

    // 提示条
    $("bannerClose").addEventListener("click", hideBanner);
    $("bannerRetry").addEventListener("click", () => { hideBanner(); DS.refresh("air"); });

    // 时钟
    tickClock();
    setInterval(tickClock, 1000);
  }

  function tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    $("clockTime").textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    $("clockDate").textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${wd}`;
  }

  /* ---------------- 播报 ---------------- */
  let tickerOffset = 0, tickerWidth = 0, tickerLast = 0;
  function updateTicker() {
    const st = DS.state;
    if (!st.national) return;
    const nat = st.national;
    const w = st.weather;
    const segs = [];

    segs.push(`全国省会平均 AQI <b>${nat.aqi}</b>（${nat.grade}）`);
    if (nat.worst) segs.push(`污染最重：<b>${nat.worst.name}</b> AQI <em>${nat.worst.aqi}</em>`);
    if (nat.best) segs.push(`空气最优：<b>${nat.best.name}</b> AQI <b>${nat.best.aqi}</b>`);
    segs.push(`PM2.5 均值 <b>${nat.pm25}</b> μg/m³ · PM10 <b>${nat.pm10}</b> μg/m³ · O₃ <b>${nat.o3}</b> μg/m³`);
    segs.push(`地表水Ⅰ~Ⅲ类优良断面 <b>${st.water.goodRate}%</b>`);
    if (w) segs.push(`代表城市气象：气温 ${w.temp}℃ · 湿度 ${w.humidity}% · 风速 ${w.wind} m/s`);
    segs.push(`数据时次 <b>${st.sourceTime ? st.sourceTime.replace("T", " ").slice(5, 16) : fmtTime(Date.now())}</b> · ${st.mode === "live" ? "实时接口" : "本地推演"}`);

    const html = segs.map((s) => `<span>${s}</span>`).join("");
    const track = $("tickerTrack");
    track.innerHTML = html + html;
    $("tickerTime").textContent = fmtTime(Date.now());
    requestAnimationFrame(() => {
      tickerWidth = track.scrollWidth / 2;
      tickerOffset = 0;
    });
  }

  function tickerLoop(ts) {
    const track = $("tickerTrack");
    if (track && tickerWidth) {
      if (!tickerLast) tickerLast = ts;
      const dt = Math.min(64, ts - tickerLast);
      tickerLast = ts;
      tickerOffset += dt * 0.045;
      if (tickerOffset >= tickerWidth) tickerOffset = 0;
      track.style.transform = `translateY(-50%) translateX(${-tickerOffset}px)`;
    }
    requestAnimationFrame(tickerLoop);
  }

  /* ---------------- 提示 ---------------- */
  let lastToast = { msg: "", at: 0 };
  function toast(msg, type) {
    const wrap = $("toastWrap");
    const now = Date.now();
    if (msg === lastToast.msg && now - lastToast.at < 8000) return; // 同类消息去重
    lastToast = { msg, at: now };
    while (wrap.children.length >= 3) wrap.removeChild(wrap.firstChild);
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 3800);
  }

  let bannerTimer = null;
  function showBanner(kind, text) {
    const b = $("banner");
    b.hidden = false;
    b.className = "banner" + (kind === "err" ? " err" : "");
    $("bannerText").textContent = text;
  }
  function hideBanner() { $("banner").hidden = true; }

  function addMark(id) {
    const p = document.getElementById(id);
    if (!p || p.querySelector(".sim-mark")) return;
    const tag = document.createElement("span");
    tag.className = "sim-mark";
    tag.textContent = "推演 DATA";
    p.appendChild(tag);
  }
  function clearMark(id) {
    const p = document.getElementById(id);
    const m = p && p.querySelector(".sim-mark");
    if (m) m.remove();
  }
  /** 推演水印：仅在对应板块打标，不清除其它板块 */
  function markSim(on, scope) {
    const list = scope ? [scope] : ["pAqi", "pRadar", "pRank", "pTrend"];
    if (on) list.forEach(addMark);
    else list.forEach(clearMark);
  }

  /* ---------------- 启动 ---------------- */
  function main() {
    bindUI();
    boot();
    requestAnimationFrame(tickerLoop);
    // 调试入口
    global.APP = {
      toast, showBanner, hideBanner,
      get selected() { return selected; },
      get layer() { return layer; }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})(window);
