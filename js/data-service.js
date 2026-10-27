/* =========================================================
   data-service.js · 数据供给层
   策略：实时接口(Open-Meteo) → 权威基线(内置文件) → 本地推演(降级)
   对外暴露：DS.on(evt, cb) / DS.start() / DS.refresh(kind) / DS.state
   ========================================================= */
(function (global) {
  "use strict";

  const { PROVINCES, iaqi, aqiLevel, aqiColor, waterColor, SOURCE_TYPES, WATER_LEVELS } = global.CFG;

  const EVENTS = {};
  function on(evt, cb) { (EVENTS[evt] || (EVENTS[evt] = [])).push(cb); }
  function emit(evt, payload) { (EVENTS[evt] || []).forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } }); }

  /* ---------------- 基线数据（权威公报口径，非实时） ---------------- */
  // 地表水：全国断面水质类别构成（《中国生态环境状况公报》口径，Ⅰ~Ⅲ类优良比例约 90.4%）
  const WATER_BASELINE = {
    version: "2025-Q4",
    updated: "2026-09-30",
    national: [
      { key: "Ⅰ",   value: 8.6 },
      { key: "Ⅱ",   value: 32.4 },
      { key: "Ⅲ",   value: 49.4 },
      { key: "Ⅳ",   value: 7.2 },
      { key: "Ⅴ",   value: 1.9 },
      { key: "劣Ⅴ", value: 0.5 }
    ],
    byProvince: {
      北京: "Ⅲ", 天津: "Ⅳ", 河北: "Ⅳ", 山西: "Ⅳ", 内蒙古: "Ⅳ",
      辽宁: "Ⅳ", 吉林: "Ⅲ", 黑龙江: "Ⅲ", 上海: "Ⅳ", 江苏: "Ⅲ",
      浙江: "Ⅱ", 安徽: "Ⅲ", 福建: "Ⅱ", 江西: "Ⅱ", 山东: "Ⅲ",
      河南: "Ⅳ", 湖北: "Ⅲ", 湖南: "Ⅲ", 广东: "Ⅲ", 广西: "Ⅱ",
      海南: "Ⅱ", 重庆: "Ⅲ", 四川: "Ⅱ", 贵州: "Ⅲ", 云南: "Ⅱ",
      西藏: "Ⅰ", 陕西: "Ⅳ", 甘肃: "Ⅳ", 青海: "Ⅱ", 宁夏: "Ⅳ",
      新疆: "Ⅳ", 台湾: "Ⅱ", 香港: "Ⅱ", 澳门: "Ⅲ"
    }
  };

  // 污染源排放构成（排污许可公开数据行业聚合口径）
  const SOURCE_BASELINE = {
    version: "2025-Q3",
    national: SOURCE_TYPES,
    // 省级污染源密度指数（0-100，工业+移动源综合）
    density: {
      北京: 62, 天津: 78, 河北: 92, 山西: 88, 内蒙古: 66, 辽宁: 84, 吉林: 61,
      黑龙江: 58, 上海: 81, 江苏: 95, 浙江: 83, 安徽: 76, 福建: 68, 江西: 64,
      山东: 96, 河南: 90, 湖北: 74, 湖南: 70, 广东: 89, 广西: 62, 海南: 38,
      重庆: 72, 四川: 71, 贵州: 60, 云南: 55, 西藏: 18, 陕西: 79, 甘肃: 57,
      青海: 30, 宁夏: 63, 新疆: 59, 台湾: 65, 香港: 48, 澳门: 41
    }
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    geo: null,
    mode: "pending",        // live | sim | pending
    partial: false,
    updatedAt: 0,
    sourceTime: "",         // 数据源时次
    provinces: [],          // 各省级行政区监测结果
    byName: {},
    national: null,
    trend: null,
    weather: null,
    water: { dist: [], goodRate: 0, version: WATER_BASELINE.version },
    sourceMix: SOURCE_TYPES.slice(),
    selected: null,
    alarms: []
  };

  /* ---------------- 数据源运行时 ---------------- */
  const runners = {};
  Object.keys(global.CFG.SOURCES).forEach((k) => {
    const cfg = global.CFG.SOURCES[k];
    runners[k] = {
      cfg,
      status: "idle",       // idle | loading | ok | warn | error
      lastOk: 0,
      latency: 0,
      nextAt: 0,
      failCount: 0,
      progress: 0,
      message: ""
    };
  });

  const CHUNK = 12;

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function getJSON(url, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || 15000);
    return fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  }

  /* ---------------- 空气数据拉取 ---------------- */
  function airUrl(list, extra) {
    const lat = list.map((p) => p.lat.toFixed(3)).join(",");
    const lon = list.map((p) => p.lon.toFixed(3)).join(",");
    return (
      global.CFG.api.airQuality +
      "?latitude=" + lat + "&longitude=" + lon +
      "&current=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide" +
      "&timezone=Asia%2FShanghai" + (extra || "")
    );
  }

  /** 拉取全部省会监测点实时浓度，折算 AQI */
  async function fetchAir() {
    const groups = chunk(PROVINCES, CHUNK);
    const results = await Promise.allSettled(groups.map((g) => getJSON(airUrl(g), 15000)));
    const okGroups = results.filter((r) => r.status === "fulfilled");
    if (!okGroups.length) throw new Error("空气质量接口全部请求失败");

    const raw = new Map(); // name -> current
    okGroups.forEach((r, gi) => {
      const data = r.value;
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((item, idx) => {
        const prov = groups[gi][idx];
        if (!prov) return;
        // 单点请求时 Open-Meteo 返回对象，多点时为数组
        const cur = item.current || (Array.isArray(data) ? null : data.current);
        if (cur) raw.set(prov.name, cur);
      });
    });

    const sourceTime = [...raw.values()].map((c) => c.time).filter(Boolean).sort().pop() || "";
    const list = PROVINCES.map((p) => compose(p, raw.get(p.name), null, WATER_BASELINE, SOURCE_BASELINE));
    return { list, partial: okGroups.length < groups.length, sourceTime };
  }

  /** 由浓度合成完整监测记录（含 AQI 折算） */
  function compose(prov, cur, simSeed, water, source) {
    let pm25, pm10, o3, no2, so2, co;
    if (cur) {
      pm25 = num(cur.pm2_5); pm10 = num(cur.pm10); o3 = num(cur.ozone);
      no2 = num(cur.nitrogen_dioxide); so2 = num(cur.sulphur_dioxide);
      co = num(cur.carbon_monoxide) != null ? num(cur.carbon_monoxide) / 1000 : null; // μg/m³ → mg/m³
    }
    if (pm25 == null) {
      // 缺失点位补齐（不伪造实时值，仅用于地图/图表连续性，标记 imputed）
      const s = simulateProvince(prov, simSeed);
      pm25 = s.pm2_5; pm10 = s.pm10; o3 = s.o3; no2 = s.no2; so2 = s.so2; co = s.co;
    }
    const sub = [
      { k: "pm2_5", v: iaqi("pm2_5", pm25) },
      { k: "pm10", v: iaqi("pm10", pm10) },
      { k: "o3", v: iaqi("o3", o3) },
      { k: "no2", v: iaqi("no2", no2) },
      { k: "so2", v: iaqi("so2", so2) },
      { k: "co", v: iaqi("co", co) }
    ].filter((x) => x.v != null);
    const top = sub.reduce((a, b) => (b.v > a.v ? b : a), { k: "pm2_5", v: 0 });
    const aqi = top.v;
    const lv = aqiLevel(aqi);
    const wKey = (water.byProvince[prov.name]) || "Ⅲ";
    return {
      name: prov.name,
      full: prov.full,
      lon: prov.lon,
      lat: prov.lat,
      region: prov.region,
      basin: prov.basin,
      aqi,
      grade: lv.label,
      color: lv.color,
      primary: aqi <= 50 ? "—" : global.CFG.POLLUTANT_META[top.k].label,
      sub,
      pm2_5: round1(pm25),
      pm10: round1(pm10),
      o3: round1(o3),
      no2: round1(no2),
      so2: round1(so2),
      co: co == null ? null : round2(co),
      water: wKey,
      waterColor: waterColor(wKey),
      density: source.density[prov.name] || 40,
      imputed: !cur
    };
  }

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  /* ---------------- 本地推演（降级用） ---------------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function simulateProvince(prov, seed) {
    const base = { 华北: 78, 东北: 62, 华东: 56, 华中: 66, 华南: 42, 西南: 45, 西北: 72 }[prov.region] || 60;
    const r = hash(prov.name + (seed || ""));
    const wave = Math.sin(Date.now() / 36e5 + r * 6.28) * 9;
    const pm25 = Math.max(4, base * (0.55 + r * 0.9) + wave);
    return {
      pm2_5: pm25,
      pm10: pm25 * (1.5 + r * 0.5),
      o3: 60 + r * 70,
      no2: 18 + r * 40,
      so2: 4 + r * 12,
      co: 0.5 + r * 0.9
    };
  }

  /** 无网络时的整表推演数据 */
  function buildSimulatedData(reason) {
    const seed = String(Math.floor(Date.now() / 6e5));
    const list = PROVINCES.map((p) => compose(p, null, seed, WATER_BASELINE, SOURCE_BASELINE));
    const partial = false;
    return { list, partial, sourceTime: "", simulated: true, reason };
  }

  /* ---------------- 趋势数据（近 24h） ---------------- */
  /** 将多个点位的 hourly 序列按小时求均值，返回最近 24 个整点 */
  function parseHourly(datas) {
    const buckets = { time: null, pm2_5: [], pm10: [], o3: [] };
    datas.forEach((data) => {
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((item) => {
        const h = item.hourly;
        if (!h || !h.time) return;
        if (!buckets.time) buckets.time = h.time.slice();
        ["pm2_5", "pm10", "ozone"].forEach((key) => {
          const src = h[key] || [];
          const dst = key === "ozone" ? buckets.o3 : buckets[key];
          src.forEach((v, i) => { if (v != null) (dst[i] || (dst[i] = [])).push(v); });
        });
      });
    });
    const times = buckets.time || [];
    const mean = (arr, i) => {
      const a = (arr[i] || []).filter((v) => v != null);
      return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    };
    const now = Date.now();
    const idxKeep = [];
    times.forEach((t, i) => { if (new Date(t.replace(" ", "T")).getTime() <= now) idxKeep.push(i); });
    const last = idxKeep.slice(-24);
    if (!last.length) throw new Error("趋势数据为空");
    return {
      times: last.map((i) => times[i].slice(11, 16)),
      pm25: last.map((i) => round1(mean(buckets.pm2_5, i))),
      pm10: last.map((i) => round1(mean(buckets.pm10, i))),
      o3: last.map((i) => round1(mean(buckets.o3, i)))
    };
  }

  async function fetchTrend() {
    const groups = chunk(PROVINCES, CHUNK);
    const results = await Promise.allSettled(
      groups.map((g) =>
        getJSON(
          global.CFG.api.airQuality +
          "?latitude=" + g.map((p) => p.lat.toFixed(3)).join(",") +
          "&longitude=" + g.map((p) => p.lon.toFixed(3)).join(",") +
          "&hourly=pm2_5,pm10,ozone&past_days=1&forecast_days=1&timezone=Asia%2FShanghai",
          15000
        )
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) throw new Error("趋势接口请求失败");
    return parseHourly(ok);
  }

  /** 单省趋势（下拉下钻时按需拉取，6 分钟内复用） */
  const provTrendCache = new Map();
  async function fetchProvinceTrend(name) {
    const p = PROVINCES.find((x) => x.name === name);
    if (!p) throw new Error("未知省份");
    const cached = provTrendCache.get(name);
    if (cached && Date.now() - cached.at < 6 * 60 * 1000) return cached.data;
    const data = await getJSON(
      global.CFG.api.airQuality +
      "?latitude=" + p.lat.toFixed(3) + "&longitude=" + p.lon.toFixed(3) +
      "&hourly=pm2_5,pm10,ozone&past_days=1&forecast_days=1&timezone=Asia%2FShanghai",
      12000
    );
    const parsed = parseHourly([data]);
    provTrendCache.set(name, { at: Date.now(), data: parsed });
    return parsed;
  }

  function simulateTrend() {
    const now = new Date();
    const times = [], pm25 = [], pm10 = [], o3 = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 36e5);
      times.push(String(d.getHours()).padStart(2, "0") + ":00");
      const dayWave = 0.75 + 0.35 * Math.sin(((23 - i) / 24) * Math.PI * 2 - 1.2);
      const base = 46 * dayWave + 6;
      pm25.push(round1(base));
      pm10.push(round1(base * 1.7));
      o3.push(round1(70 + 30 * Math.sin(((23 - i) / 24) * Math.PI * 2 + 0.6)));
    }
    return { times, pm25, pm10, o3, simulated: true };
  }

  /* ---------------- 气象（8 个代表城市，用于协同研判） ---------------- */
  const WEATHER_CITIES = ["北京", "上海", "广州", "成都", "武汉", "西安", "哈尔滨", "乌鲁木齐"];
  async function fetchWeather() {
    const list = PROVINCES.filter((p) => WEATHER_CITIES.includes(p.name));
    const url =
      global.CFG.api.weather +
      "?latitude=" + list.map((p) => p.lat.toFixed(3)).join(",") +
      "&longitude=" + list.map((p) => p.lon.toFixed(3)).join(",") +
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation" +
      "&timezone=Asia%2FShanghai";
    const data = await getJSON(url, 15000);
    const arr = Array.isArray(data) ? data : [data];
    const rows = arr.map((d) => d.current).filter(Boolean);
    if (!rows.length) throw new Error("气象接口无数据");
    const avg = (k) => round1(rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length);
    return {
      temp: avg("temperature_2m"),
      humidity: avg("relative_humidity_2m"),
      wind: avg("wind_speed_10m"),
      rain: avg("precipitation"),
      count: rows.length
    };
  }

  /* ---------------- 基线文件读取 ---------------- */
  async function loadBaseline() {
    try {
      const [w, s] = await Promise.all([
        getJSON("./data/water-baseline.json", 6000).catch(() => WATER_BASELINE),
        getJSON("./data/source-baseline.json", 6000).catch(() => SOURCE_BASELINE)
      ]);
      state.water.version = w.version || WATER_BASELINE.version;
      state.sourceMix = (s.national || SOURCE_TYPES).slice();
      return { water: w, source: s };
    } catch (e) {
      return { water: WATER_BASELINE, source: SOURCE_BASELINE };
    }
  }

  async function loadGeo() {
    try {
      const geo = await getJSON(global.CFG.api.geo, 20000);
      state.geo = geo;
      return geo;
    } catch (e) {
      // file:// 直开或 data/china.json 缺失时的本地兜底（data/china-geo.js 预置）
      if (global.CHINA_GEO && global.CHINA_GEO.features) {
        state.geo = global.CHINA_GEO;
        return global.CHINA_GEO;
      }
      throw e;
    }
  }

  /* ---------------- 聚合统计 ---------------- */
  function aggregate(list) {
    const valid = list.filter((p) => p.aqi != null);
    const avg = (k) => round1(valid.reduce((s, p) => s + (p[k] || 0), 0) / (valid.length || 1));
    const sorted = valid.slice().sort((a, b) => b.aqi - a.aqi);
    const good = valid.filter((p) => p.aqi <= 100).length;
    const subAvg = ["pm2_5", "pm10", "o3", "no2", "so2", "co"].map((k) => ({
      k,
      v: round2(valid.reduce((s, p) => s + (p[k] || 0), 0) / (valid.length || 1))
    }));
    const aqiAvg = Math.round(valid.reduce((s, p) => s + p.aqi, 0) / (valid.length || 1));
    return {
      aqi: aqiAvg,
      grade: aqiLevel(aqiAvg).label,
      color: aqiColor(aqiAvg),
      pm25: avg("pm2_5"),
      pm10: avg("pm10"),
      o3: avg("o3"),
      no2: avg("no2"),
      so2: avg("so2"),
      co: avg("co"),
      subAvg,
      goodCount: good,
      total: valid.length,
      goodRate: Math.round((good / (valid.length || 1)) * 1000) / 10,
      worst: sorted[0] || null,
      best: sorted[sorted.length - 1] || null,
      stations: valid.length,           // 实际参与计算的监测点位（省会/特别行政区）
      imputed: valid.filter((p) => p.imputed).length
    };
  }

  /* ---------------- 预警生成 ---------------- */
  function buildAlarms(list, weather) {
    const items = [];
    const stamp = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const now = `${p(stamp.getHours())}:${p(stamp.getMinutes())}`;

    list
      .filter((x) => x.aqi > 100)
      .sort((a, b) => b.aqi - a.aqi)
      .slice(0, 6)
      .forEach((x) => {
        items.push({
          id: "aqi-" + x.name,
          time: now,
          level: x.aqi > 200 ? 3 : x.aqi > 150 ? 2 : 2,
          title: `${x.name} AQI ${x.aqi} · ${x.grade}`,
          desc: `首要污染物 ${x.primary} · PM2.5 ${x.pm2_5} μg/m³ · 建议启动区域联防`
        });
      });

    if (weather && weather.wind != null && weather.wind < 2) {
      items.push({
        id: "met-" + Math.floor(Date.now() / 36e5),
        time: now,
        level: 2,
        title: "静稳天气 · 扩散条件不利",
        desc: `代表城市平均风速 ${weather.wind} m/s、湿度 ${weather.humidity}%，污染物易累积。`
      });
    }

    const badWater = list.filter((x) => x.water === "劣Ⅴ" || x.water === "Ⅴ");
    if (badWater.length) {
      items.push({
        id: "water-" + badWater.map((b) => b.name).join(""),
        time: now,
        level: 1,
        title: `水质预警断面 ${badWater.length} 处`,
        desc: `${badWater.slice(0, 4).map((b) => b.name).join("、")} 断面为 ${badWater[0].water} 类，需核查上游排口。`
      });
    }

    if (!items.length) {
      items.push({
        id: "ok",
        time: now,
        level: 1,
        title: "全域未触发污染预警",
        desc: "各省会城市 AQI 均处于优良区间，系统持续巡检中。"
      });
    }
    return items;
  }

  /* ---------------- 调度 ---------------- */
  function scheduleRunner(key) {
    const r = runners[key];
    r.nextAt = Date.now() + r.cfg.interval;
    r.progress = 0;
  }

  async function runTask(key) {
    const r = runners[key];
    if (r.status === "loading") return;
    r.status = "loading";
    r.message = "";
    emit("runner", { key, runner: r });
    const t0 = performance.now();
    try {
      let payload;
      if (key === "air") payload = await fetchAir();
      else if (key === "trend") payload = await fetchTrend();
      else if (key === "weather") payload = await fetchWeather();
      else if (key === "water") { await loadBaseline(); payload = { ok: true }; }
      else if (key === "source") { payload = { ok: true }; }

      r.latency = Math.round(performance.now() - t0);
      r.lastOk = Date.now();
      r.status = payload && payload.partial ? "warn" : "ok";
      r.failCount = 0;
      r.message = payload && payload.partial ? "部分节点未返回" : "";
      scheduleRunner(key);

      if (key === "air") applyAir(payload);
      if (key === "trend") { state.trend = payload; emit("trend", payload); }
      if (key === "weather") { state.weather = payload; emit("weather", payload); }
      if (key === "water" || key === "source") emit("data", state);
      emit("runner", { key, runner: r });
    } catch (err) {
      r.failCount += 1;
      r.status = "error";
      r.latency = Math.round(performance.now() - t0);
      const raw = err && err.message ? err.message : "网络异常";
      r.message = /Failed to fetch|NetworkError|Load failed/i.test(raw) ? "网络不可达或请求被拦截"
        : (err && err.name === "AbortError") ? "请求超时" : raw;
      const backoff = Math.min(300000, 10000 * Math.pow(2, r.failCount - 1));
      r.nextAt = Date.now() + backoff;
      emit("runner", { key, runner: r });
      emit("error", { key, message: r.message, failCount: r.failCount, nextIn: backoff });

      // 连续失败降级
      if (key === "air" && r.failCount >= 1) {
        // 首次失败即回退到本地推演，保持界面可用；后续按指数退避持续重试，成功即恢复实时
        applyAir(buildSimulatedData(r.message));
      }
      if (key === "trend" && r.failCount >= 2 && !state.trend) {
        state.trend = simulateTrend();
        emit("trend", state.trend);
        emit("degraded", { key, message: "趋势接口不可用，已切换本地推演序列" });
      }
    }
  }

  function applyAir(payload) {
    const prev = state.byName;
    state.provinces = payload.list;
    state.byName = {};
    payload.list.forEach((p) => { state.byName[p.name] = p; });
    state.national = aggregate(payload.list);
    state.mode = payload.simulated ? "sim" : "live";
    state.partial = !!payload.partial;
    state.updatedAt = Date.now();
    state.sourceTime = payload.sourceTime || "";
    state.alarms = buildAlarms(payload.list, state.weather);

    // 水质分布（基线）
    if (!state.water.dist.length) {
      state.water.dist = WATER_BASELINE.national.map((d) => ({
        key: d.key, value: d.value, color: waterColor(d.key)
      }));
      const good = WATER_BASELINE.national
        .filter((d) => ["Ⅰ", "Ⅱ", "Ⅲ"].includes(d.key))
        .reduce((s, d) => s + d.value, 0);
      state.water.goodRate = Math.round(good * 10) / 10;
    }
    emit("data", state);
    if (payload.simulated) emit("degraded", { key: "air", message: "空气质量接口不可用，已切换本地推演数据" });
  }

  /* ---------------- 对外 API ---------------- */
  const DS = {
    state,
    runners,
    on,
    emit,
    loadGeo,
    loadBaseline,
    async start() {
      await loadBaseline();
      // 首屏：优先并行拉取空气与趋势
      const tasks = [
        runTask("air"),
        runTask("trend"),
        runTask("weather")
      ];
      // 基线源仅记录状态
      ["water", "source"].forEach((k) => {
        runners[k].status = "ok";
        runners[k].lastOk = Date.now();
        scheduleRunner(k);
      });
      await Promise.allSettled(tasks);
      // 周期任务
      setInterval(() => {
        const now = Date.now();
        Object.keys(runners).forEach((k) => {
          const r = runners[k];
          if (r.nextAt && now >= r.nextAt - 40 && r.status !== "loading") {
            if (k === "air" || k === "trend" || k === "weather") runTask(k);
            else { r.lastOk = Date.now(); scheduleRunner(k); }
          }
        });
      }, 1000);
      // 每秒推送一次倒计时
      setInterval(() => emit("tick", runners), 1000);
    },
    refresh(kind) {
      if (kind) return runTask(kind);
      return Promise.allSettled(["air", "trend", "weather"].map(runTask));
    },
    trendFor(name) { return fetchProvinceTrend(name); },
    select(name) {
      state.selected = name && state.byName[name] ? name : null;
      emit("select", state.selected);
    }
  };

  global.DS = DS;
})(window);
