(() => {
  "use strict";

  const DIR = document.body.dataset.dir === "in" ? "in" : "out";
  const ROUTES = ["56", "56A"];
  const REFRESH_MS = 30000;

  const STOPS = {
    out: {
      board: { id: "003767", name: "NOVO LAND", detail: "欣寶路" },
      alight: { id: "003378", name: "上水站 D2", detail: "新運路" },
      destRe: /上水|天平|皇后|粉嶺|SHEUNG|TIN PING|QUEEN|FANLING/i,
      destLabel: "上水站",
    },
    in: {
      board: { id: "003849", name: "上水站 D1", detail: "新運路" },
      alight: { id: "003753", name: "NOVO LAND", detail: "欣寶路" },
      destRe: /屯門|菁田|和田|欣寶|TUEN MUN|CHING TIN|WO TIN|NOVO/i,
      destLabel: "NOVO LAND",
    },
  };

  const cfg = STOPS[DIR];
  const $ = (id) => document.getElementById(id);

  const state = {
    board: [],
    alight: [],
    errors: [],
    updatedAt: null,
    ride: 35,
  };

  const pad = (n) => String(n).padStart(2, "0");

  function fmt(d) {
    const x = d instanceof Date ? d : new Date(d);
    return Number.isNaN(x.getTime()) ? "--:--" : `${pad(x.getHours())}:${pad(x.getMinutes())}`;
  }

  function addMin(d, m) {
    return new Date(d.getTime() + m * 60000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function minsUntil(eta, now) {
    return Math.round((eta.getTime() - now.getTime()) / 60000);
  }

  function waitLabel(mins) {
    if (mins < 0) return `已過 ${Math.abs(mins)} 分鐘`;
    if (mins === 0) return "即將到站";
    if (mins < 60) return `${mins} 分鐘`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
  }

  function isWeekend(date) {
    const d = date.getDay();
    return d === 0 || d === 6;
  }

  function parseHHMM(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function atMinutes(day, mins) {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(mins);
    return d;
  }

  function win(start, end, every, route, dest, offset) {
    return { start, end, every, route, dest, offset };
  }

  /**
   * 官方班表：運輸署 2024-07-28 調整，班距取 bustop／681 總站資料。
   * 56A 只在平日繁忙行走；56 負責平日非繁忙及週末全日。兩線互補。
   * offset 把總站開出時刻推到本頁上車點（NOVO LAND 或上水站）。
   */
  function windowsFor(date) {
    if (DIR === "out") {
      if (isWeekend(date)) {
        return [
          win("06:30", "18:10", 20, "56", "天平邨", 2),
          win("18:10", "20:10", 30, "56", "天平邨", 2),
        ];
      }
      return [
        win("06:30", "07:00", 10, "56A", "皇后山邨", 2),
        win("07:00", "07:30", 15, "56A", "皇后山邨", 2),
        win("07:30", "08:50", 20, "56A", "皇后山邨", 2),
        win("09:10", "14:50", 20, "56", "天平邨", 2),
        win("15:10", "17:50", 20, "56A", "皇后山邨", 2),
        win("18:10", "20:10", 30, "56", "天平邨", 2),
      ];
    }
    if (isWeekend(date)) {
      return [
        win("06:45", "08:45", 30, "56", "屯門(菁田邨)", 5),
        win("08:45", "21:45", 20, "56", "屯門(菁田邨)", 5),
      ];
    }
    return [
      win("06:30", "06:50", 20, "56A", "屯門(菁田邨)", 20),
      win("06:50", "08:50", 30, "56A", "屯門(菁田邨)", 20),
      win("09:25", "17:05", 20, "56", "屯門(菁田邨)", 5),
      win("17:10", "17:40", 15, "56A", "屯門(菁田邨)", 20),
      win("17:40", "19:20", 20, "56A", "屯門(菁田邨)", 20),
      win("19:55", "20:15", 20, "56", "屯門(菁田邨)", 5),
      win("20:15", "21:45", 30, "56", "屯門(菁田邨)", 5),
    ];
  }

  function expandWindow(day, item) {
    const out = [];
    const start = parseHHMM(item.start);
    const end = parseHHMM(item.end);
    for (let t = start; t <= end; t += item.every) {
      out.push({
        route: item.route,
        dest: item.dest,
        eta: addMin(atMinutes(day, t), item.offset),
        scheduled: true,
        source: "estimate",
      });
    }
    return out;
  }

  function scheduledBoard(from, until) {
    const days = [new Date(from)];
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    if (until >= next) days.push(next);
    const list = [];
    days.forEach((day) => {
      windowsFor(day).forEach((item) => list.push(...expandWindow(day, item)));
    });
    return uniqueByMinute(list.filter((x) => x.eta >= from && x.eta <= until));
  }

  function activeWindow(now) {
    const mins = now.getHours() * 60 + now.getMinutes();
    return windowsFor(now).find((item) => {
      const a = parseHHMM(item.start) + item.offset;
      const b = parseHHMM(item.end) + item.offset;
      return mins >= a - 8 && mins <= b + 8;
    }) || null;
  }

  function nextScheduled(now) {
    return scheduledBoard(now, addMin(now, 18 * 60))[0] || null;
  }

  function rideMinutes(now) {
    const winNow = activeWindow(now);
    if (winNow && ((winNow.start <= "08:50" && winNow.end <= "09:00") || winNow.start >= "15:10")) {
      return 42;
    }
    const min = now.getHours() * 60 + now.getMinutes();
    if (!isWeekend(now) && ((min >= 420 && min <= 540) || (min >= 1020 && min <= 1140))) return 42;
    return 35;
  }

  function waitParts(mins) {
    if (mins < 0) return { num: String(Math.abs(mins)), unit: "分鐘前", soon: false };
    if (mins === 0) return { num: "即將", unit: "到站", soon: true };
    return { num: String(mins), unit: "分鐘", soon: mins <= 8 };
  }

  function etaBadge(iso, mins) {
    const parts = waitParts(mins);
    return `
      <div class="eta-badge${parts.soon ? " soon" : ""}" data-eta="${iso}">
        <strong class="wait-num">${escapeHtml(parts.num)}</strong>
        <em class="wait-unit">${escapeHtml(parts.unit)}</em>
      </div>`;
  }

  function serviceHint(now) {
    const next = nextScheduled(now);
    if (activeWindow(now)) return "";
    if (!next) return "今日已過尾班";
    return `暫時沒有班次，下一班 ${next.route} 約 ${fmt(next.eta)}`;
  }

  function isScheduled(rmk) {
    return /原定|Scheduled/i.test(rmk || "");
  }

  function srcOf(item) {
    if (!item || item.source === "estimate") return { label: "班表推算", kind: "est" };
    if (item.scheduled) return { label: "原定班次", kind: "sched" };
    return { label: "實時", kind: "live" };
  }

  function routeClass(route) {
    return route === "56A" ? "is-56a" : "is-56";
  }

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function etaUrls(stop, route) {
    const direct = `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${stop}/${route}`;
    if (location.protocol === "file:") return [direct];
    return [`/proxy/ctb/eta/${stop}/${route}`, direct];
  }

  async function fetchEta(stop, route) {
    const errors = [];
    for (const url of etaUrls(stop, route)) {
      try {
        const json = await fetchJson(url);
        return Array.isArray(json && json.data) ? json.data : [];
      } catch (err) {
        errors.push(String((err && err.message) || err));
      }
    }
    throw new Error(errors.join(" / ") || "fetch failed");
  }

  function parseRows(rows, destRe) {
    return (rows || [])
      .filter((r) => r.eta && destRe.test(`${r.dest_tc || ""}${r.dest_en || ""}`))
      .map((r) => ({
        route: r.route,
        dest: r.dest_tc || r.dest_en || "",
        eta: new Date(r.eta),
        seq: Number(r.seq),
        scheduled: isScheduled(r.rmk_tc || r.rmk_en),
        source: "live",
        rmk: r.rmk_tc || r.rmk_en || "",
      }))
      .filter((r) => !Number.isNaN(r.eta.getTime()));
  }

  function uniqueByMinute(list) {
    const seen = new Set();
    return (list || [])
      .slice()
      .sort((a, b) => a.eta - b.eta)
      .filter((item) => {
        const key = `${item.route}-${Math.round(item.eta.getTime() / 60000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function estimateBoard(from, until) {
    return scheduledBoard(from, until);
  }

  function mergeCandidates(liveList, estimateList) {
    const live = uniqueByMinute(liveList);
    const rest = (estimateList || []).slice().sort((a, b) => a.eta - b.eta);
    if (!live.length) return rest;
    const horizon = addMin(live[live.length - 1].eta, 5);
    return [...live, ...rest.filter((b) => b.eta > horizon)].sort((a, b) => a.eta - b.eta);
  }

  function pairTrips(boardList, alightList, ride) {
    const used = new Set();
    const minRide = Math.max(22, ride - 10);
    const keyOf = (c) => `${c.route}-${c.eta.getTime()}`;
    return boardList.map((item) => {
      const expect = addMin(item.eta, ride);
      const earliest = addMin(item.eta, minRide);
      const candidates = (alightList || []).filter((c) => {
        if (used.has(keyOf(c))) return false;
        if (item.route && c.route && c.route !== item.route) return false;
        if (c.eta < earliest) return false;
        return Math.abs(c.eta - expect) <= 16 * 60000;
      });
      if (!candidates.length) {
        return { item, arrive: { eta: expect, source: "estimate" } };
      }
      const hit = candidates.sort((a, b) => Math.abs(a.eta - expect) - Math.abs(b.eta - expect))[0];
      used.add(keyOf(hit));
      const live = hit.source === "live" && !hit.scheduled;
      return { item, arrive: { eta: hit.eta, source: live ? "live" : hit.source } };
    });
  }

  function tripsNow(now) {
    const from = addMin(now, -2);
    const until = addMin(now, 150);
    const live = state.board.filter((r) => r.eta >= from && r.eta <= until);
    const merged = mergeCandidates(live, estimateBoard(now, until)).slice(0, 6);
    return pairTrips(merged, state.alight, state.ride);
  }

  function arrivalsNow(now) {
    const from = addMin(now, -1);
    const until = addMin(now, 90);
    return uniqueByMinute(state.alight.filter((r) => r.eta >= from && r.eta <= until)).slice(0, 6);
  }

  function renderClock() {
    $("clock").textContent = fmt(new Date());
  }

  function renderHero(trips, now) {
    const el = $("hero");
    const next = trips.find((t) => minsUntil(t.item.eta, now) >= 0) || trips[0];
    if (!next) {
      el.className = "hero empty";
      el.innerHTML = `
        <p class="hero-kicker">下一班</p>
        <p class="hero-wait">這個時段暫時沒有班次</p>
        <p class="hero-time">--:--</p>
        <p class="hero-dest">${escapeHtml(serviceHint(now))}</p>`;
      return;
    }

    const mins = minsUntil(next.item.eta, now);
    const parts = waitParts(mins);
    el.className = `hero ${routeClass(next.item.route)}${parts.soon ? " soon" : ""}`;
    el.innerHTML = `
      <div class="hero-copy">
        <p class="hero-kicker">下一班 · ${escapeHtml(cfg.board.name)}</p>
        <p class="hero-time">${fmt(next.item.eta)}</p>
        <span class="hero-route mark ${next.item.route === "56A" ? "r56a" : "r56"}">${escapeHtml(next.item.route)}</span>
        <p class="hero-dest">預計 ${fmt(next.arrive.eta)} 抵達 ${escapeHtml(cfg.destLabel)} · ${escapeHtml(next.item.dest || "")}</p>
      </div>
      <div class="eta-badge hero-eta${parts.soon ? " soon" : ""}" data-eta="${next.item.eta.toISOString()}">
        <strong class="wait-num">${escapeHtml(parts.num)}</strong>
        <em class="wait-unit">${escapeHtml(parts.unit)}</em>
      </div>`;
  }

  function renderTrips(trips, now) {
    const host = $("trips");
    if (!trips.length) {
      host.innerHTML = `
        <div class="empty">
          <strong>未有即將開出的班次</strong>
          ${escapeHtml(serviceHint(now))}
        </div>`;
      return;
    }

    host.innerHTML = trips
      .map((row, i) => {
        const { item, arrive } = row;
        const mins = minsUntil(item.eta, now);
        const boardSrc = srcOf(item);
        const destSrc = arrive.source === "live" ? { label: "實時", kind: "live" } : { label: "估算", kind: "est" };
        return `
          <article class="trip ${routeClass(item.route)}" style="--i:${i}">
            <div class="trip-route">${escapeHtml(item.route)}</div>
            <div class="trip-body">
              <strong>${escapeHtml(item.dest || cfg.destLabel)}</strong>
              <em>${escapeHtml(cfg.board.name)} 上車<span class="tag ${boardSrc.kind}">${boardSrc.label}</span></em>
              <div class="times">
                <div>
                  <span>上車</span>
                  <time>${fmt(item.eta)}</time>
                </div>
                <div>
                  <span>抵達 ${escapeHtml(cfg.destLabel)}</span>
                  <time>${fmt(arrive.eta)}</time>
                </div>
              </div>
              <p class="dest-src"><span class="tag ${destSrc.kind}">終點${destSrc.label}</span></p>
            </div>
            ${etaBadge(item.eta.toISOString(), mins)}
          </article>`;
      })
      .join("");
  }

  function renderArrivals(list, now) {
    const host = $("arrivals");
    if (!list.length) {
      host.innerHTML = `<div class="empty">終點暫時沒有即將到站的實時資料</div>`;
      return;
    }
    host.innerHTML = list
      .map((item, i) => {
        const mins = minsUntil(item.eta, now);
        const src = srcOf(item);
        return `
          <article class="arrival ${routeClass(item.route)}" style="--i:${i}">
            <div class="arrival-route">${escapeHtml(item.route)}</div>
            <div class="arrival-body">
              <strong>${escapeHtml(cfg.alight.name)}</strong>
              <em>${escapeHtml(item.dest || "")}<span class="tag ${src.kind}">${src.label}</span></em>
              <time class="arrive-at">${fmt(item.eta)}</time>
            </div>
            ${etaBadge(item.eta.toISOString(), mins)}
          </article>`;
      })
      .join("");
  }

  function renderStatus() {
    const el = $("status");
    if (!state.updatedAt) {
      el.className = "status";
      el.textContent = "正在讀取實時班次…";
      return;
    }
    const n = state.errors.length;
    el.className = n ? "status err" : "status";
    el.textContent = n
      ? `更新於 ${fmt(state.updatedAt)} · ${n} 個接口沒拿到，缺口以官方班表推算填補`
      : `更新於 ${fmt(state.updatedAt)} · 實時來自城巴開放數據，班表按 2024-07-28 運輸署調整`;
  }

  function paint() {
    const now = new Date();
    state.ride = rideMinutes(now);
    $("rideHint").textContent = `車程約 ${state.ride} 分鐘（估算）`;
    const trips = tripsNow(now);
    renderHero(trips, now);
    renderTrips(trips, now);
    renderArrivals(arrivalsNow(now), now);
    renderStatus();
    $("liveDot").hidden = !state.board.some((r) => r.source === "live");
  }

  function tickWaits() {
    const now = new Date();
    document.querySelectorAll("[data-eta]").forEach((el) => {
      const eta = new Date(el.dataset.eta);
      if (Number.isNaN(eta.getTime())) return;
      const mins = minsUntil(eta, now);
      const parts = waitParts(mins);
      const num = el.querySelector(".wait-num");
      const unit = el.querySelector(".wait-unit");
      if (num && num.textContent !== parts.num) num.textContent = parts.num;
      if (unit && unit.textContent !== parts.unit) unit.textContent = parts.unit;
      el.classList.toggle("soon", parts.soon);
    });
    const hero = $("hero");
    const badge = hero.querySelector(".hero-eta[data-eta], .eta-badge[data-eta]");
    if (badge) {
      const mins = minsUntil(new Date(badge.dataset.eta), now);
      hero.classList.toggle("soon", waitParts(mins).soon);
    }
  }

  async function refresh() {
    const btn = $("refresh");
    btn.disabled = true;
    const jobs = ROUTES.flatMap((route) => [
      fetchEta(cfg.board.id, route),
      fetchEta(cfg.alight.id, route),
    ]);
    const results = await Promise.allSettled(jobs);
    const errors = [];
    const board = [];
    const alight = [];

    results.forEach((result, i) => {
      if (result.status !== "fulfilled") {
        errors.push(String(result.reason && result.reason.message ? result.reason.message : result.reason));
        return;
      }
      const parsed = parseRows(result.value, cfg.destRe);
      if (i % 2 === 0) board.push(...parsed);
      else alight.push(...parsed);
    });

    state.board = uniqueByMinute(board);
    state.alight = uniqueByMinute(alight);
    state.errors = errors;
    state.updatedAt = new Date();
    btn.disabled = false;
    paint();
  }

  function syncStandaloneChrome() {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const color = dark ? "#121318" : "#eceae4";
    const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    const theme = document.querySelector('meta[name="theme-color"]:not([media])');
    if (bar) bar.setAttribute("content", dark ? "black" : "default");
    if (theme) theme.setAttribute("content", color);
  }

  function bind() {
    syncStandaloneChrome();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    if (scheme.addEventListener) scheme.addEventListener("change", syncStandaloneChrome);
    else if (scheme.addListener) scheme.addListener(syncStandaloneChrome);
    renderClock();
    setInterval(renderClock, 1000);
    $("refresh").addEventListener("click", refresh);
    refresh();
    setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    setInterval(() => {
      if (state.updatedAt) tickWaits();
    }, 1000);
  }

  bind();
})();
