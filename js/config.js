/* =========================================================
   config.js · 常量、行政区监测点、评级口径与配色
   数据口径：AQI 按 HJ 633-2012《环境空气质量指数(AQI)技术规定》
   ========================================================= */
(function (global) {
  "use strict";

  /* ---------- 34 个省级行政区 · 省会/首府监测点（经纬度 WGS84） ---------- */
  const PROVINCES = [
    { name: "北京",     full: "北京市",         lon: 116.41, lat: 39.90, region: "华北", basin: "海河" },
    { name: "天津",     full: "天津市",         lon: 117.20, lat: 39.13, region: "华北", basin: "海河" },
    { name: "河北",     full: "河北省",         lon: 114.51, lat: 38.04, region: "华北", basin: "海河" },
    { name: "山西",     full: "山西省",         lon: 112.55, lat: 37.87, region: "华北", basin: "黄河" },
    { name: "内蒙古",   full: "内蒙古自治区",   lon: 111.75, lat: 40.84, region: "华北", basin: "黄河" },
    { name: "辽宁",     full: "辽宁省",         lon: 123.43, lat: 41.80, region: "东北", basin: "辽河" },
    { name: "吉林",     full: "吉林省",         lon: 125.32, lat: 43.82, region: "东北", basin: "松花江" },
    { name: "黑龙江",   full: "黑龙江省",       lon: 126.53, lat: 45.80, region: "东北", basin: "松花江" },
    { name: "上海",     full: "上海市",         lon: 121.47, lat: 31.23, region: "华东", basin: "太湖" },
    { name: "江苏",     full: "江苏省",         lon: 118.80, lat: 32.06, region: "华东", basin: "长江" },
    { name: "浙江",     full: "浙江省",         lon: 120.15, lat: 30.27, region: "华东", basin: "钱塘江" },
    { name: "安徽",     full: "安徽省",         lon: 117.23, lat: 31.82, region: "华东", basin: "淮河" },
    { name: "福建",     full: "福建省",         lon: 119.30, lat: 26.07, region: "华东", basin: "闽江" },
    { name: "江西",     full: "江西省",         lon: 115.86, lat: 28.68, region: "华东", basin: "鄱阳湖" },
    { name: "山东",     full: "山东省",         lon: 117.12, lat: 36.65, region: "华东", basin: "黄河" },
    { name: "河南",     full: "河南省",         lon: 113.63, lat: 34.75, region: "华中", basin: "淮河" },
    { name: "湖北",     full: "湖北省",         lon: 114.31, lat: 30.59, region: "华中", basin: "长江" },
    { name: "湖南",     full: "湖南省",         lon: 112.94, lat: 28.23, region: "华中", basin: "洞庭湖" },
    { name: "广东",     full: "广东省",         lon: 113.26, lat: 23.13, region: "华南", basin: "珠江" },
    { name: "广西",     full: "广西壮族自治区", lon: 108.32, lat: 22.82, region: "华南", basin: "珠江" },
    { name: "海南",     full: "海南省",         lon: 110.32, lat: 20.04, region: "华南", basin: "海南岛" },
    { name: "重庆",     full: "重庆市",         lon: 106.55, lat: 29.56, region: "西南", basin: "长江" },
    { name: "四川",     full: "四川省",         lon: 104.07, lat: 30.57, region: "西南", basin: "长江" },
    { name: "贵州",     full: "贵州省",         lon: 106.63, lat: 26.65, region: "西南", basin: "乌江" },
    { name: "云南",     full: "云南省",         lon: 102.72, lat: 25.04, region: "西南", basin: "澜沧江" },
    { name: "西藏",     full: "西藏自治区",     lon: 91.14,  lat: 29.65, region: "西南", basin: "雅鲁藏布江" },
    { name: "陕西",     full: "陕西省",         lon: 108.94, lat: 34.34, region: "西北", basin: "渭河" },
    { name: "甘肃",     full: "甘肃省",         lon: 103.83, lat: 36.06, region: "西北", basin: "黄河" },
    { name: "青海",     full: "青海省",         lon: 101.78, lat: 36.62, region: "西北", basin: "黄河" },
    { name: "宁夏",     full: "宁夏回族自治区", lon: 106.23, lat: 38.49, region: "西北", basin: "黄河" },
    { name: "新疆",     full: "新疆维吾尔自治区", lon: 87.62, lat: 43.83, region: "西北", basin: "塔里木河" },
    { name: "台湾",     full: "台湾省",         lon: 121.57, lat: 25.03, region: "华东", basin: "淡水河" },
    { name: "香港",     full: "香港特别行政区", lon: 114.17, lat: 22.32, region: "华南", basin: "珠江" },
    { name: "澳门",     full: "澳门特别行政区", lon: 113.54, lat: 22.20, region: "华南", basin: "珠江" }
  ];

  /* ---------- AQI 分级（HJ 633-2012） ---------- */
  const AQI_LEVELS = [
    { max: 50,       label: "优",     color: "#1ee6c2" },
    { max: 100,      label: "良",     color: "#35c8ff" },
    { max: 150,      label: "轻度污染", color: "#ffd166" },
    { max: 200,      label: "中度污染", color: "#ff8a4c" },
    { max: 300,      label: "重度污染", color: "#ff4d6d" },
    { max: Infinity, label: "严重污染", color: "#c026d3" }
  ];

  /* ---------- IAQI 分段表 ---------- */
  const IAQI_STEPS = [0, 50, 100, 150, 200, 300, 400, 500];
  const POLLUTANT_BREAKS = {
    pm2_5: [0, 35, 75, 115, 150, 250, 350, 500],
    pm10:  [0, 50, 150, 250, 350, 420, 500, 600],
    so2:   [0, 50, 150, 475, 800, 1600, 2100, 2620],
    no2:   [0, 40, 80, 180, 280, 565, 750, 940],
    co:    [0, 2, 4, 14, 24, 36, 48, 60],
    o3:    [0, 100, 160, 215, 265, 800, 1000, 1200]
  };

  const POLLUTANT_META = {
    pm2_5: { label: "PM2.5", unit: "μg/m³", full: "细颗粒物" },
    pm10:  { label: "PM10",  unit: "μg/m³", full: "可吸入颗粒物" },
    o3:    { label: "O₃",    unit: "μg/m³", full: "臭氧" },
    no2:   { label: "NO₂",   unit: "μg/m³", full: "二氧化氮" },
    so2:   { label: "SO₂",   unit: "μg/m³", full: "二氧化硫" },
    co:    { label: "CO",    unit: "mg/m³", full: "一氧化碳" }
  };

  /* ---------- 水质类别（GB 3838-2002） ---------- */
  const WATER_LEVELS = [
    { key: "Ⅰ",   color: "#2ee6b0", drinkable: true },
    { key: "Ⅱ",   color: "#35d6ff", drinkable: true },
    { key: "Ⅲ",   color: "#4a8cff", drinkable: true },
    { key: "Ⅳ",   color: "#ffd166", drinkable: false },
    { key: "Ⅴ",   color: "#ff8a4c", drinkable: false },
    { key: "劣Ⅴ", color: "#ff4d6d", drinkable: false }
  ];

  /* ---------- 污染源构成（基线：排污许可公开数据行业聚合口径） ---------- */
  const SOURCE_TYPES = [
    { name: "工业源", value: 41.6, color: "#35d6ff" },
    { name: "移动源", value: 26.3, color: "#1c6bff" },
    { name: "扬尘源", value: 14.2, color: "#7ff0ff" },
    { name: "生活源", value: 11.1, color: "#b45cff" },
    { name: "农业源", value: 6.8,  color: "#ffb454" }
  ];

  /* ---------- 数据源定义（驱动健康度面板与刷新调度） ---------- */
  const SOURCES = {
    air: {
      key: "air",
      label: "空气质量 API",
      vendor: "Open-Meteo · CAMS",
      interval: 10 * 60 * 1000,
      timeout: 15000,
      nature: "live"
    },
    trend: {
      key: "trend",
      label: "24h 时序 API",
      vendor: "Open-Meteo · CAMS",
      interval: 10 * 60 * 1000,
      timeout: 15000,
      nature: "live"
    },
    weather: {
      key: "weather",
      label: "气象协同 API",
      vendor: "Open-Meteo · IFS",
      interval: 15 * 60 * 1000,
      timeout: 15000,
      nature: "live"
    },
    water: {
      key: "water",
      label: "地表水基线",
      vendor: "生态环境部公报口径",
      interval: 24 * 60 * 60 * 1000,
      timeout: 8000,
      nature: "baseline"
    },
    source: {
      key: "source",
      label: "污染源基线",
      vendor: "排污许可公开数据",
      interval: 24 * 60 * 60 * 1000,
      timeout: 8000,
      nature: "baseline"
    }
  };

  /* ---------- 工具函数 ---------- */
  function aqiLevel(v) {
    for (let i = 0; i < AQI_LEVELS.length; i++) if (v <= AQI_LEVELS[i].max) return AQI_LEVELS[i];
    return AQI_LEVELS[AQI_LEVELS.length - 1];
  }
  function aqiColor(v) { return aqiLevel(v).color; }

  /** 线性插值计算单项 IAQI（HJ 633-2012 附录A） */
  function iaqi(pollutant, conc) {
    const bp = POLLUTANT_BREAKS[pollutant];
    if (!bp || conc == null || isNaN(conc) || conc < 0) return null;
    for (let i = 1; i < bp.length; i++) {
      if (conc <= bp[i]) {
        const cLo = bp[i - 1], cHi = bp[i];
        const iLo = IAQI_STEPS[i - 1], iHi = IAQI_STEPS[i];
        const v = ((iHi - iLo) / (cHi - cLo)) * (conc - cLo) + iLo;
        return Math.round(Math.min(500, Math.max(0, v)));
      }
    }
    return 500;
  }

  function waterColor(key) {
    const f = WATER_LEVELS.find((w) => w.key === key);
    return f ? f.color : "#4a6b8a";
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  global.CFG = {
    PROVINCES,
    AQI_LEVELS,
    IAQI_STEPS,
    POLLUTANT_BREAKS,
    POLLUTANT_META,
    WATER_LEVELS,
    SOURCE_TYPES,
    SOURCES,
    api: {
      airQuality: "https://air-quality-api.open-meteo.com/v1/air-quality",
      weather: "https://api.open-meteo.com/v1/forecast",
      geo: "./data/china.json"
    },
    aqiLevel,
    aqiColor,
    iaqi,
    waterColor,
    fmtTime,
    fmtDateTime
  };
})(window);
