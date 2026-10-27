/* =========================================================
   charts.js · ECharts 图表层
   ========================================================= */
(function (global) {
  "use strict";

  const { POLLUTANT_META, aqiLevel, aqiColor, WATER_LEVELS } = global.CFG;
  const FONT = '"Bahnschrift","DIN Alternate","HarmonyOS Sans SC","PingFang SC",sans-serif';

  const inst = {};
  const AXIS_COLOR = "rgba(126,157,190,.65)";
  const SPLIT = "rgba(64,190,255,.12)";

  function el(id) { return document.getElementById(id); }
  function get(id) {
    if (!inst[id]) {
      const dom = el(id);
      if (!dom) return null;
      inst[id] = echarts.init(dom, null, { renderer: "canvas" });
    }
    return inst[id];
  }

  function empty(id, text) {
    const c = get(id);
    if (!c) return;
    c.clear();
    c.setOption({
      graphic: [{
        type: "text", left: "center", top: "middle",
        style: { text: text || "暂无数据", fill: "rgba(126,157,190,.65)", font: '12px ' + FONT }
      }]
    });
  }

  /* ---------------- 1. AQI 仪表 ---------------- */
  // 环带按 HJ 633-2012 分级比例绘制（量程 0–300，超出则环形满格）
  const GAUGE_MAX = 300;
  const LEVEL_BANDS = [
    [50 / GAUGE_MAX, "#1ee6c2"], [100 / GAUGE_MAX, "#35c8ff"], [150 / GAUGE_MAX, "#ffd166"],
    [200 / GAUGE_MAX, "#ff8a4c"], [300 / GAUGE_MAX, "#ff4d6d"], [1, "#c026d3"]
  ];

  function updateGauge(national) {
    const c = get("gaugeAqi");
    if (!c) return;
    const v = national ? national.aqi : 0;
    const color = aqiColor(v);
    const grad = new echarts.graphic.LinearGradient(0, 0, 1, 0, [
      { offset: 0, color: "rgba(28,107,255,.55)" },
      { offset: 0.5, color },
      { offset: 1, color: "#eafcff" }
    ]);
    c.setOption({
      animationDuration: 900,
      series: [
        {
          type: "gauge", startAngle: 212, endAngle: -32, radius: "94%", center: ["50%", "56%"],
          min: 0, max: GAUGE_MAX, silent: true,
          axisLine: { lineStyle: { width: 3, color: LEVEL_BANDS } },
          axisTick: { show: true, length: 3, distance: -6, lineStyle: { color: "rgba(64,190,255,.35)", width: 1 } },
          splitLine: { show: true, length: 6, distance: -8, lineStyle: { color: "rgba(53,214,255,.55)", width: 1 } },
          axisLabel: { show: false },
          pointer: { show: false },
          detail: { show: false },
          data: []
        },
        {
          type: "gauge", startAngle: 212, endAngle: -32, radius: "76%", center: ["50%", "56%"],
          min: 0, max: GAUGE_MAX, silent: true,
          axisLine: { lineStyle: { width: 10, color: [[1, "rgba(53,214,255,.14)"]] } },
          progress: { show: true, width: 10, itemStyle: { color: grad, shadowColor: color, shadowBlur: 14 } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          detail: { show: false },
          title: { show: false },
          data: [{ value: Math.min(GAUGE_MAX, v) }]
        }
      ]
    }, true);
  }

  /* ---------------- 2. 六项污染物雷达 ---------------- */
  // 归一化基准：环境空气质量标准(GB 3095-2012)二级日均/8h限值
  const STANDARD = { pm2_5: 75, pm10: 150, o3: 160, no2: 80, so2: 150, co: 4 };
  const RADAR_KEYS = ["pm2_5", "pm10", "o3", "no2", "so2", "co"];

  function updateRadar(values, label) {
    const c = get("chartRadar");
    if (!c || !values) return;
    const raw = RADAR_KEYS.map((k) => values[k] || 0);
    const norm = RADAR_KEYS.map((k, i) => Math.min(150, Math.round((raw[i] / STANDARD[k]) * 100)));
    const maxRatio = Math.max.apply(null, norm);
    const mainColor = maxRatio >= 100 ? "#ffd166" : "#35d6ff";

    c.setOption({
      animationDuration: 700,
      textStyle: { fontFamily: FONT },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(4,16,30,.94)",
        borderColor: "rgba(64,200,255,.45)",
        textStyle: { color: "#d8ecff", fontSize: 11 },
        formatter: () => {
          return RADAR_KEYS.map((k, i) => {
            const m = POLLUTANT_META[k];
            return `${m.label}：<b style="color:#7ff0ff">${raw[i]}</b> ${m.unit} <span style="color:#7e9dbe">(国标 ${STANDARD[k]}，${norm[i]}%)</span>`;
          }).join("<br/>");
        }
      },
      radar: {
        center: ["50%", "53%"], radius: "68%",
        splitNumber: 4, shape: "polygon",
        indicator: RADAR_KEYS.map((k) => ({ name: POLLUTANT_META[k].label, max: 150 })),
        axisName: { color: "#9bc0dc", fontSize: 10.5, formatter: (n) => n },
        splitArea: {
          areaStyle: { color: ["rgba(28,107,255,.03)", "rgba(53,214,255,.05)"] }
        },
        splitLine: { lineStyle: { color: ["rgba(64,190,255,.12)", "rgba(64,190,255,.16)", "rgba(64,190,255,.22)", "rgba(64,190,255,.3)"] } },
        axisLine: { lineStyle: { color: "rgba(64,190,255,.16)" } }
      },
      series: [{
        type: "radar",
        symbol: "circle", symbolSize: 4,
        lineStyle: { color: mainColor, width: 1.6, shadowColor: mainColor, shadowBlur: 10 },
        itemStyle: { color: mainColor, borderColor: "#04121f", borderWidth: 1 },
        areaStyle: {
          color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.85, [
            { offset: 0, color: "rgba(53,214,255,.05)" },
            { offset: 1, color: "rgba(53,214,255,.42)" }
          ])
        },
        data: [{ value: norm, name: label || "当前浓度" }]
      }, {
        type: "radar",
        symbol: "none",
        silent: true,
        z: 1,
        lineStyle: { color: "rgba(255,180,84,.5)", width: 1, type: "dashed" },
        itemStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        data: [{ value: [100, 100, 100, 100, 100, 100], name: "国标二级限值" }]
      }]
    }, true);
  }

  /* ---------------- 3. 城市排名 ---------------- */
  function updateRank(list, dir) {
    const c = get("chartRank");
    if (!c || !list || !list.length) return;
    const sorted = list.slice().sort((a, b) => (dir === "best" ? a.aqi - b.aqi : b.aqi - a.aqi)).slice(0, 10);
    // 横向条形图自下而上绘制，故倒序
    const rows = sorted.slice().reverse();

    c.setOption({
      animationDuration: 700,
      textStyle: { fontFamily: FONT },
      grid: { left: 44, right: 46, top: 8, bottom: 4, containLabel: false },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(53,214,255,.07)" } },
        backgroundColor: "rgba(4,16,30,.94)", borderColor: "rgba(64,200,255,.45)",
        textStyle: { color: "#d8ecff", fontSize: 11 },
        formatter: (p) => {
          const d = sorted.find((x) => x.name === p[0].name);
          if (!d) return "";
          return `<b>${d.name}</b> · ${d.grade}<br/>AQI <b style="color:${d.color}">${d.aqi}</b>　首要污染物 ${d.primary}<br/>PM2.5 ${d.pm2_5} μg/m³`;
        }
      },
      xAxis: { type: "value", max: 320, show: false },
      yAxis: {
        type: "category",
        data: rows.map((r) => r.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#9bc0dc", fontSize: 10.5, margin: 6 }
      },
      series: [{
        type: "bar", barWidth: 9,
        showBackground: true,
        backgroundStyle: { color: "rgba(53,214,255,.06)" },
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: (p) => {
            const col = rows[p.dataIndex].color;
            return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: "rgba(28,107,255,.25)" },
              { offset: 1, color: col }
            ]);
          },
          shadowColor: "rgba(53,214,255,.35)", shadowBlur: 6
        },
        label: {
          show: true, position: "right", distance: 6,
          formatter: (p) => `{v|${p.value}}`,
          rich: { v: { color: "#cdeaff", fontSize: 11, fontFamily: FONT, fontWeight: 600 } }
        },
        data: rows.map((r) => r.aqi)
      }]
    }, true);
  }

  /* ---------------- 4. 水质类别 ---------------- */
  function updateWater(water) {
    const c = get("chartWater");
    if (!c || !water || !water.dist.length) return;
    const data = water.dist.map((d) => ({
      name: d.key + "类", value: d.value, itemStyle: { color: d.color }
    }));
    c.setOption({
      animationDuration: 800,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(4,16,30,.94)", borderColor: "rgba(64,200,255,.45)",
        textStyle: { color: "#d8ecff", fontSize: 11 },
        formatter: (p) => `${p.name}<br/><b style="color:${p.color}">${p.value}%</b> 断面占比`
      },
      title: {
        text: water.goodRate + "%",
        subtext: "Ⅰ~Ⅲ 类优良",
        left: "center", top: "35%",
        textStyle: { color: "#eafcff", fontSize: 21, fontFamily: FONT, fontWeight: 700 },
        subtextStyle: { color: "rgba(126,157,190,.9)", fontSize: 9.5 }
      },
      series: [{
        type: "pie",
        radius: ["58%", "82%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: { borderColor: "rgba(5,16,30,.9)", borderWidth: 1 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 4, itemStyle: { shadowBlur: 16, shadowColor: "rgba(53,214,255,.6)" } },
        data
      }]
    }, true);

    // 图例（DOM）
    const ul = el("waterLegend");
    if (ul) {
      ul.innerHTML = water.dist.map((d) =>
        `<li><i style="background:${d.color};box-shadow:0 0 6px ${d.color}"></i>${d.key} 类<b>${d.value}%</b></li>`
      ).join("");
    }
  }

  /* ---------------- 5. 24h 趋势 ---------------- */
  function updateTrend(trend, label) {
    const c = get("chartTrend");
    if (!c || !trend || !trend.times || !trend.times.length) return;
    const mk = (name, data, color) => ({
      name, type: "line", smooth: 0.35, showSymbol: false, symbol: "circle", symbolSize: 5,
      lineStyle: { width: 1.8, color, shadowColor: color, shadowBlur: 8 },
      itemStyle: { color },
      areaStyle: name === "PM2.5" ? {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(53,214,255,.35)" },
          { offset: 1, color: "rgba(53,214,255,0)" }
        ])
      } : undefined,
      data
    });

    c.setOption({
      animationDuration: 800,
      textStyle: { fontFamily: FONT },
      grid: { left: 34, right: 12, top: 26, bottom: 22 },
      legend: {
        right: 4, top: 0, itemWidth: 8, itemHeight: 8, itemGap: 10,
        textStyle: { color: "rgba(126,157,190,.95)", fontSize: 10 },
        icon: "roundRect"
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(4,16,30,.94)", borderColor: "rgba(64,200,255,.45)",
        textStyle: { color: "#d8ecff", fontSize: 11 },
        axisPointer: { type: "line", lineStyle: { color: "rgba(53,214,255,.45)", type: "dashed" } },
        valueFormatter: (v) => (v == null ? "—" : v + " μg/m³")
      },
      xAxis: {
        type: "category", boundaryGap: false, data: trend.times,
        axisLine: { lineStyle: { color: "rgba(64,190,255,.18)" } },
        axisTick: { show: false },
        axisLabel: { color: AXIS_COLOR, fontSize: 9.5, interval: Math.max(0, Math.floor(trend.times.length / 6) - 1) }
      },
      yAxis: {
        type: "value", name: "μg/m³", nameTextStyle: { color: "rgba(126,157,190,.7)", fontSize: 9, padding: [0, 0, 0, -18] },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: AXIS_COLOR, fontSize: 9.5 },
        splitLine: { lineStyle: { color: SPLIT, type: "dashed" } }
      },
      series: [
        mk("PM2.5", trend.pm25, "#35d6ff"),
        mk("PM10", trend.pm10, "#b45cff"),
        mk("O₃", trend.o3, "#2ee6b0")
      ]
    }, true);
    const note = el("trendScope");
    if (note) note.textContent = label || "全国均值";
  }

  /* ---------------- 6. 污染源构成 ---------------- */
  function updateSource(mix) {
    const c = get("chartSource");
    if (!c || !mix) return;
    c.setOption({
      animationDuration: 800,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(4,16,30,.94)", borderColor: "rgba(64,200,255,.45)",
        textStyle: { color: "#d8ecff", fontSize: 11 },
        formatter: (p) => `${p.name}<br/><b style="color:${p.color}">${p.value}%</b> 排放贡献`
      },
      legend: {
        orient: "vertical", right: 4, top: "middle", itemWidth: 7, itemHeight: 7, itemGap: 8,
        textStyle: { color: "rgba(126,157,190,.95)", fontSize: 10 }
      },
      series: [{
        type: "pie",
        roseType: "radius",
        radius: ["24%", "76%"],
        center: ["33%", "52%"],
        itemStyle: { borderColor: "rgba(5,16,30,.9)", borderWidth: 1, borderRadius: 2 },
        label: {
          show: true, position: "inside", fontSize: 9.5,
          color: "rgba(4,16,30,.85)", fontWeight: 600,
          formatter: (p) => (p.value > 9 ? p.value + "%" : "")
        },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 5, itemStyle: { shadowBlur: 18, shadowColor: "rgba(53,214,255,.55)" } },
        data: mix.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } }))
      }]
    }, true);
  }

  /* ---------------- 7. 南海诸岛插图（合规必备） ---------------- */
  function initInset(geo) {
    const dom = el("insetMap");
    if (!dom) return;
    const chart = echarts.init(dom, null, { renderer: "canvas" });

    // 主体地图注册（剔除九段线要素，避免以面状误渲）
    const jd = geo.features.find((f) => f.properties && f.properties.adcode === "100000_JD");
    const insetGeo = {
      type: "FeatureCollection",
      features: geo.features.filter((f) => f.properties && f.properties.name)
    };
    echarts.registerMap("china_inset", insetGeo);

    // 九段线逐段折线
    const dash = [];
    if (jd) {
      const polys = jd.geometry.type === "MultiPolygon" ? jd.geometry.coordinates : [jd.geometry.coordinates];
      polys.forEach((poly) => poly.forEach((ring) => {
        if (ring.length >= 2) dash.push({ coords: ring.map((c) => [c[0], c[1]]) });
      }));
    }

    chart.setOption({
      geo: {
        map: "china_inset",
        boundingCoords: [[106.5, 2.8], [125.5, 25.5]],
        roam: false,
        silent: true,
        itemStyle: {
          areaColor: "rgba(32,96,158,.78)",
          borderColor: "rgba(110,220,255,.75)",
          borderWidth: 0.7
        },
        emphasis: { disabled: true },
        label: { show: false }
      },
      series: [{
        type: "lines",
        coordinateSystem: "geo",
        polyline: true,
        silent: true,
        z: 6,
        lineStyle: { color: "rgba(150,245,255,.95)", width: 1.3, type: [3, 2] },
        data: dash
      }]
    });
    inst.insetMap = chart;
  }

  /* ---------------- resize ---------------- */
  function resize() {
    Object.keys(inst).forEach((k) => { try { inst[k].resize(); } catch (e) {} });
  }
  let rt = null;
  global.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(resize, 180);
  });

  global.Charts = {
    init: function () {
      ["gaugeAqi", "chartRadar", "chartRank", "chartWater", "chartTrend", "chartSource"].forEach(get);
    },
    updateGauge, updateRadar, updateRank, updateWater, updateTrend, updateSource,
    initInset, resize, empty,
    get: (id) => inst[id]
  };
})(window);
