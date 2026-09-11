import {
  text,
  setMarkup,
  animateIn,
  selectSegment,
  lightSweep,
  beginJourneyMotion,
  setJourneyDrift,
  captureHeroHeight,
  animateJourneyPath,
} from "./motion.js?v=sheen5";
import {
  REFRESH_MS,
  EXPIRE_MS,
  hkTime,
  hkParts,
  auto74Service,
  cleanName,
  waitMinutes,
  parseEta,
  findPair,
  journeyStopKey,
  findJourneyPair,
  defaultRide,
  variantLabel,
  freshness,
  reconcileKmb,
} from "./model.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const CTB = {
  out: {
    board: { id: "003767", name: "NOVO LAND · 欣寶路", seq: 1 },
    alight: { id: "003378", name: "上水站 · 新運路 D2", seq: 2 },
    bound: "O",
    destRe: /上水|天平|皇后|粉嶺|SHEUNG|TIN PING|QUEEN|FANLING/i,
  },
  in: {
    board: { id: "003849", name: "上水站 · 新運路 D1", seq: 1 },
    alight: { id: "003753", name: "NOVO LAND · 欣寶路", seq: 2 },
    bound: "I",
    destRe: /屯門|菁田|和田|欣寶|TUEN MUN|CHING TIN|WO TIN|NOVO/i,
  },
};
const state = {
  route: "56",
  direction: "out",
  mode: "auto",
  boardId: null,
  alightId: null,
  ride: null,
  ride75: null,
  routes: [],
  feeds: new Map(),
  busy: false,
  loaded: false,
  lastAttempt: 0,
  lastSuccess: 0,
  controller: null,
  revision: 0,
  metadataWarning: false,
  metadataChecked: 0,
};
let baseVariant = null;
let selectionReady = false;
let loadingHintTimer = null;
let loadingHintVisible = false;
// Settings have one stable home across phone, tablet and desktop layouts.
document.querySelector(".more-options-content").prepend($("variantWrap"));
$("moreOptions").open = false;

const safeRead = () => {
  try {
    return JSON.parse(localStorage.getItem("bus-journey-v2") || "{}");
  } catch {
    return {};
  }
};
const saved = safeRead();
const params = new URLSearchParams(location.search);
const initialRoute = params.get("route") || saved.route;
if (["56", "74K", "75F"].includes(initialRoute))
  state.route = initialRoute === "75F" ? "74K" : initialRoute;
if ((params.get("direction") || saved.direction) === "in")
  state.direction = "in";
if (location.pathname.endsWith("/inbound.html")) {
  state.route = "56";
  state.direction = "in";
}
if (saved.route === state.route && saved.direction === state.direction) {
  if (["auto", "1", "2"].includes(saved.mode)) state.mode = saved.mode;
  state.boardId = saved.boardId;
  state.alightId = saved.alightId;
}
function persist() {
  try {
    localStorage.setItem(
      "bus-journey-v2",
      JSON.stringify({
        route: state.route,
        direction: state.direction,
        mode: state.mode,
        boardId: state.boardId,
        alightId: state.alightId,
      }),
    );
  } catch {}
  const url = new URL(location.href);
  url.searchParams.set("route", state.route);
  url.searchParams.set("direction", state.direction);
  if (url.pathname.endsWith("/inbound.html"))
    url.pathname = url.pathname.replace(/inbound\.html$/, "index.html");
  history.replaceState(null, "", url);
}
const service = () =>
  state.mode === "auto"
    ? state.route === "74K"
      ? auto74Service()
      : 1
    : Number(state.mode);
const kmbVariants = () =>
  state.routes.filter(
    (v) =>
      (v.route === "74K" && v.bound === "O") ||
      (v.route === "75F" &&
        v.bound === (state.direction === "out" ? "O" : "I")),
  );
const displayedVariants = () =>
  kmbVariants().filter((v) => v.route === "75F" || v.service === service());
const selectedPair = () =>
  state.route === "56"
    ? findPair(baseVariant.stops, state.boardId, state.alightId)
    : displayedVariants()
        .map((v) => findJourneyPair(v.stops, state.boardId, state.alightId))
        .find(Boolean);
const groupStop = (s) => ({
  ...s,
  id: journeyStopKey(s),
  name:
    journeyStopKey(s) === "tai-po-market"
      ? "大埔墟站"
      : journeyStopKey(s) === "eduhk"
        ? "香港教育大學"
        : s.name,
});
const uniqueStops = (stops) => [
  ...new Map(
    stops.map((s) => {
      const item = groupStop(s);
      return [item.id, item];
    }),
  ).values(),
];
function chooseVariant() {
  return kmbVariants().find(
    (v) => v.route === "74K" && v.service === service(),
  );
}
function setOptions(id, stops, selected) {
  $(id).innerHTML = stops
    .map(
      (s) =>
        `<option value="${s.id}"${s.id === selected ? " selected" : ""}>${esc(s.name)}</option>`,
    )
    .join("");
}
function setupJourney({ reset = false } = {}) {
  if (reset) {
    state.boardId = null;
    state.alightId = null;
    state.ride = null;
    state.ride75 = null;
  }
  $("ride75Wrap").hidden = state.route === "56";
  text("variantLabel", "74K 行車版本");
  document
    .querySelectorAll("[data-route]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.route === state.route)),
    );
  document
    .querySelectorAll("[data-direction]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.direction === state.direction),
      ),
    );
  selectSegment(".route-tabs", state.route === "56" ? 0 : 1);
  selectSegment(".direction-control", state.direction === "out" ? 0 : 1);
  text("operator", state.route === "56" ? "城巴" : "九巴");
  text("outLabel", state.route === "56" ? "去上水" : "去教育大學");
  text("inLabel", state.route === "56" ? "回 NOVO LAND" : "回大埔墟站");
  $("variantWrap").hidden = state.route === "56";
  $("stopDetails").hidden = state.route === "56";
  if (state.route === "56") {
    baseVariant = {
      route: "56",
      service: 1,
      stops: [CTB[state.direction].board, CTB[state.direction].alight],
    };
    state.boardId = baseVariant.stops[0].id;
    state.alightId = baseVariant.stops[1].id;
    setOptions("board", [baseVariant.stops[0]], state.boardId);
    setOptions("alight", [baseVariant.stops[1]], state.alightId);
    $("board").disabled = true;
    $("alight").disabled = true;
  } else {
    const opts = [
      ["auto", "自動 · 按香港時間"],
      ["1", "中午 12:00 前 · 先經教育大學"],
      ["2", "中午 12:00 起 · 先經三門仔"],
    ];
    $("variant").innerHTML = opts
      .map(
        ([v, label]) =>
          `<option value="${v}"${v === state.mode ? " selected" : ""}>${label}</option>`,
      )
      .join("");
    baseVariant = chooseVariant();
    if (!baseVariant) throw new Error("未能載入此路線的車站資料");
    const variants = displayedVariants();
    // Migrate saved physical stop IDs from the previous separate route tabs.
    for (const key of ["boardId", "alightId"]) {
      const previous = state.routes
        .flatMap((v) => v.stops)
        .find((s) => s.id === state[key]);
      if (previous) state[key] = journeyStopKey(previous);
    }
    const boardOptions = uniqueStops(
      variants.flatMap((v) => v.stops.slice(0, -1)),
    );
    if (!boardOptions.some((s) => s.id === state.boardId))
      state.boardId = state.direction === "out" ? "tai-po-market" : "eduhk";
    const downstream = uniqueStops(
      variants.flatMap((v) => {
        const board = v.stops.find((s) => journeyStopKey(s) === state.boardId);
        return board
          ? v.stops.filter(
              (s) => s.seq > board.seq && journeyStopKey(s) !== state.boardId,
            )
          : [];
      }),
    );
    if (!downstream.some((s) => s.id === state.alightId)) {
      const target = state.direction === "out" ? "eduhk" : "tai-po-market";
      state.alightId =
        downstream.find((s) => s.id === target)?.id || downstream.at(-1)?.id;
    }
    setOptions("board", boardOptions, state.boardId);
    setOptions("alight", downstream, state.alightId);
    $("board").disabled = false;
    $("alight").disabled = false;
    text(
      "variantHint",
      (state.mode === "auto"
        ? `74K 現用${service() === 1 ? "中午前" : "中午後"}站序。`
        : "74K 版本以大埔墟開出時間為準。") +
        "75F 一般及特別班次會一起列出；各線月台不同，請留意班次上的上車站。",
    );
  }
  const pair = selectedPair();
  text(
    "journeySummary",
    `${cleanName(pair.board.name).replace(/ · .*/, "")} → ${cleanName(pair.alight.name).replace(/ · .*/, "")}`,
  );
  text("stopCount", state.route === "56" ? "直達行程" : "各線車程不同");
  text("routeStopCount", state.route === "56" ? "" : "74K / 75F");
  $("stopList").innerHTML =
    state.route === "56"
      ? ""
      : displayedVariants()
          .map(
            (v) =>
              `<section><h3>${v.route} · ${variantLabel(v.route, v.service)}</h3><ol>${v.stops.map((s) => `<li value="${s.seq}" class="${[state.boardId, state.alightId].includes(journeyStopKey(s)) ? "selected" : ""}">${esc(s.name)}${journeyStopKey(s) === state.boardId ? " · 上車" : journeyStopKey(s) === state.alightId ? " · 落車" : ""}</li>`).join("")}</ol></section>`,
          )
          .join("");
  updateRide();
  const notes = {
    56: [
      "56 與 56A 一起看",
      "保留 NOVO LAND ↔ 上水的常用行程，按到站時間排列。班次及服務安排以城巴最新資料為準。",
      "https://mobile.citybus.com.hk/nwp3/?f=1&ds=56&dsmode=1&l=0",
    ],
    "74K": [
      "74K / 75F 一起看",
      "兩線按上車時間一起排列。74K 中午前先經教大，中午後先經三門仔；75F 為平日指定繁忙時段特快線，部分早班經工業邨。大埔墟及教大的上車月台不同，班次卡會列明。",
      "https://search.kmb.hk/KMBWebSite/?action=routesearch&route=74K&lang=zh-hk",
    ],
    "75F": [
      "教育大學特快線",
      "星期一至五繁忙時間服務，公眾假期及特定日子除外。早上往教大，下午回大埔墟；部分早班經大埔工業邨。",
      "https://e.kmb.hk/news_detail.html?id=1412&year=2026",
    ],
  };
  const note = notes[state.route];
  text("serviceTitle", note[0]);
  text("serviceNote", note[1]);
  $("officialLink").href = note[2];
  document.title = `${state.route === "56" ? "56／56A" : "74K／75F"} · ${cleanName(pair.alight.name)} · 就到站`;
  selectionReady = true;
  persist();
}
function updateRide() {
  if (state.route === "56") {
    const ride =
      state.ride ?? defaultRide("56", state.direction, 1, null, null);
    text("rideSummary", `約 ${ride} 分鐘`);
    text("rideLabel", "自訂車程（分鐘）");
    $("ride").value = ride;
    return;
  }
  const estimates = displayedVariants()
    .map((v) => ({
      v,
      pair: findJourneyPair(v.stops, state.boardId, state.alightId),
    }))
    .filter((x) => x.pair);
  const values = (route) =>
    estimates
      .filter((x) => x.v.route === route)
      .map(({ v, pair }) =>
        defaultRide(v.route, state.direction, v.service, pair, v.stops),
      );
  const values74 = values("74K"),
    values75 = values("75F");
  const ride74 = state.ride ?? values74[0],
    ride75 = state.ride75 ?? values75[0];
  $("ride").disabled = !values74.length;
  $("ride").value = ride74 ?? "";
  $("ride75").disabled = !values75.length;
  $("ride75").value = ride75 ?? "";
  text("rideLabel", "74K 自訂車程（分鐘）");
  const range = (list, override) =>
    override !== null
      ? String(override)
      : Math.min(...list) === Math.max(...list)
        ? String(list[0])
        : [Math.min(...list), Math.max(...list)].join("–");
  text(
    "rideSummary",
    [
      values74.length ? "74K " + range(values74, state.ride) : "",
      values75.length ? "75F " + range(values75, state.ride75) : "",
    ]
      .filter(Boolean)
      .join(" · ") + " 分鐘",
  );
}
function apiURL(operator, path) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (local) return `/proxy/${operator.toLowerCase()}/${path}`;
  return operator === "KMB"
    ? `https://data.etabus.gov.hk/v1/transport/kmb/${path}`
    : `https://rt.data.gov.hk/v2/transport/citybus/${path}`;
}
async function getJSON(url, signal) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!json || !Array.isArray(json.data)) throw new Error("資料格式不正確");
  return json;
}
function activeVariants() {
  return kmbVariants()
    .map((v) => ({
      ...v,
      pair: findJourneyPair(v.stops, state.boardId, state.alightId),
    }))
    .filter((v) => v.pair);
}
function feedJobs() {
  if (state.route === "56")
    return ["56", "56A"].flatMap((route) =>
      ["board", "alight"].map((side) => ({
        key: `CTB/${state.direction}/${route}/${side}`,
        operator: "CTB",
        route,
        side,
        url: apiURL("CTB", `eta/CTB/${CTB[state.direction][side].id}/${route}`),
      })),
    );
  return activeVariants().map((v) => ({
    key: `KMB/${v.route}/${v.service}`,
    operator: "KMB",
    route: v.route,
    service: v.service,
    url: apiURL("KMB", `route-eta/${v.route}/${v.service}`),
  }));
}
async function refresh({ replace = false } = {}) {
  if (!selectionReady) return;
  if (state.busy && !replace) return;
  if (replace) state.controller?.abort();
  const revision = ++state.revision;
  const ctrl = new AbortController();
  state.controller = ctrl;
  state.busy = true;
  state.lastAttempt = Date.now();
  $("refresh").disabled = true;
  $("hero").setAttribute("aria-busy", "true");
  clearTimeout(loadingHintTimer);
  if (!state.loaded) {
    loadingHintVisible = false;
    // Only show loading copy when the wait is noticeable; never delay real data.
    loadingHintTimer = setTimeout(() => {
      if (revision !== state.revision || !state.busy || state.loaded) return;
      loadingHintVisible = true;
      render();
    }, 300);
  }
  render();
  const jobs = feedJobs();
  const results = await Promise.allSettled(
    jobs.map(async (job) => ({
      job,
      json: await getJSON(job.url, ctrl.signal),
    })),
  );
  if (revision !== state.revision) return;
  clearTimeout(loadingHintTimer);
  loadingHintTimer = null;
  results.forEach((result, i) => {
    const job = jobs[i];
    if (result.status === "fulfilled") {
      const { json } = result.value;
      const rowTimes = json.data
        .map((r) => Date.parse(r.data_timestamp))
        .filter(Number.isFinite);
      const sourceAt = rowTimes.length
        ? Math.min(...rowTimes)
        : Date.parse(json.data_timestamp || json.generated_timestamp);
      state.feeds.set(job.key, {
        json,
        sourceAt,
        receivedAt: Date.now(),
        failed: false,
      });
      state.lastSuccess = Date.now();
    } else {
      const prior = state.feeds.get(job.key);
      state.feeds.set(job.key, {
        ...prior,
        failed: true,
        error: String(result.reason),
      });
    }
  });
  state.busy = false;
  state.loaded = true;
  $("refresh").disabled = false;
  $("hero").setAttribute("aria-busy", "false");
  render();
}
function rowsFor(side, now) {
  const all = [];
  if (state.route === "56") {
    for (const route of ["56", "56A"]) {
      const feed = state.feeds.get(`CTB/${state.direction}/${route}/${side}`);
      if (!feed?.json) continue;
      const cfg = CTB[state.direction];
      const rows = parseEta(
        feed.json,
        { operator: "CTB", route, bound: cfg.bound, destRe: cfg.destRe },
        now,
      );
      const ride =
        state.ride ?? defaultRide("56", state.direction, 1, null, null, now);
      all.push(...rows.map((r) => ({ ...r, failed: feed.failed, ride })));
    }
  } else
    for (const v of activeVariants()) {
      const feed = state.feeds.get(`KMB/${v.route}/${v.service}`);
      if (!feed?.json) continue;
      const rows = parseEta(
        feed.json,
        {
          operator: "KMB",
          route: v.route,
          bound: v.bound,
          service: v.service,
          seq: v.pair[side].seq,
        },
        now,
      );
      const ride =
        (v.route === "75F" ? state.ride75 : state.ride) ??
        defaultRide(v.route, state.direction, v.service, v.pair, v.stops, now);
      all.push(
        ...rows.map((r) => ({
          ...r,
          failed: feed.failed,
          ride,
          boardStop: v.pair.board.name,
          alightStop: v.pair.alight.name,
        })),
      );
    }
  return (
    state.route === "56"
      ? all.sort((a, b) => a.eta - b.eta)
      : ["74K", "75F"]
          .flatMap((route) =>
            reconcileKmb(
              all.filter((r) => r.route === route),
              {
                route,
                mode: route === "74K" ? state.mode : "auto",
                atOrigin: side === "board" && state.boardId === "tai-po-market",
              },
            ),
          )
          .sort((a, b) => a.eta - b.eta)
  ).slice(0, 6);
}
function sourceLabel(row, now) {
  if (
    row.failed ||
    !navigator.onLine ||
    freshness(row.sourceAt, now) !== "fresh"
  )
    return { label: "上次資料", className: "stale" };
  return row.scheduled
    ? { label: "原定班次", className: "scheduled" }
    : { label: "實時預報", className: "" };
}
const badge = (r) =>
  `<span class="route-badge route-${esc(r.route)}">${esc(r.route)}</span>`;
const rideRange = (r) =>
  r.rideMin !== undefined && r.rideMin !== r.rideMax
    ? [r.rideMin, r.rideMax].join("–")
    : String(r.ride);
const arrivalTime = (r) =>
  r.rideMin !== undefined && r.rideMin !== r.rideMax
    ? [
        hkTime(r.eta + r.rideMin * 60000),
        hkTime(r.eta + r.rideMax * 60000),
      ].join("–")
    : hkTime(r.eta + r.ride * 60000);
function render() {
  captureHeroHeight();
  const now = Date.now();
  text("clock", hkTime(now, true));
  text(
    "date",
    new Intl.DateTimeFormat("zh-Hant-HK", {
      timeZone: "Asia/Hong_Kong",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(now) + " · 香港",
  );
  if (!selectionReady) return;
  const jobs = feedJobs(),
    feeds = jobs.map((j) => state.feeds.get(j.key));
  const failed = feeds.filter((f) => f?.failed).length;
  const stale = feeds.some(
    (f) => f?.json && freshness(f.sourceAt, now) !== "fresh",
  );
  const offline = !navigator.onLine;
  const loading = !state.loaded;
  const warning = offline || failed > 0 || stale;
  const messages = [];
  if (offline) messages.push("你目前已離線；重新連線後會立即更新。");
  else if (failed)
    messages.push(
      `${failed === jobs.length ? "未能連接到站資料" : "部分班次更新失敗"}，30 秒後自動重試。`,
    );
  if (stale)
    messages.push(
      "部分資料已超過 2 分鐘，請勿依賴舊倒數；超過 5 分鐘會停止顯示。",
    );
  if (state.metadataWarning)
    messages.push("車站資料暫用已核對版本，稍後會重試更新。");
  $("alert").hidden = !messages.length;
  text("alert", messages.join(" "));
  text(
    "connection",
    offline
      ? "目前離線"
      : loading
        ? "正在連線"
        : warning
          ? "資料待更新"
          : "自動更新中",
  );
  $("connection").classList.toggle("warning", warning);
  const board = rowsFor("board", now),
    arrivals = rowsFor("alight", now);
  text("resultCount", board.length ? `${board.length} 班` : "");
  const pair = selectedPair();
  const next = board[0];
  if (!next) {
    $("hero").className = "island empty-island";
    const title = loading
      ? "正在讀取到站時間"
      : warning
        ? "暫時未能取得到站時間"
        : "暫未有到站預報";
    const detail = loading
      ? "連接巴士公司開放數據…"
      : warning
        ? "請稍後再試；過期資料不會繼續顯示為實時預報。"
        : state.route === "75F"
          ? "75F 只於指定繁忙時段服務，可切換 74K 查看其他班次。"
          : "巴士公司暫未提供這個行程的班次，不一定代表全日停駛。";
    setMarkup(
      "hero",
      `<span class="island-eyebrow">${esc(state.route === "56" ? "56 / 56A" : "74K / 75F")} · ${esc(cleanName(pair.board.name))}</span>${loading && !loadingHintVisible ? '<div class="pending-arrival" aria-hidden="true"><span></span><span></span></div>' : `<h3>${title}</h3><p>${detail}</p>${loading ? '<div class="loading-track" aria-hidden="true"></div>' : ""}`}`,
    );
  } else {
    const mins = waitMinutes(next.eta, now),
      src = sourceLabel(next, now),
      old = src.className === "stale";
    $("hero").className = "island";
    setMarkup(
      "hero",
      `<div class="island-top"><span class="island-eyebrow">下一班 · ${esc(cleanName(pair.board.name).replace(/ · .*/, ""))}</span><span class="source-pill ${src.className}">${src.label}</span></div><div class="island-main"><div>${badge(next)}<p class="route-meta">${esc(next.variant || variantLabel(next.route, next.service))}</p>${next.boardStop ? `<p class="platform-note">上車：${esc(next.boardStop)}</p>` : ""}</div><div class="wait ${mins <= 2 ? "soon" : ""} ${old || mins === 0 ? "words" : ""}"><strong>${old ? "待更新" : mins === 0 ? "即將" : mins}</strong><span>${old ? "" : mins === 0 ? "到站" : "分鐘"}</span></div></div><div class="island-bottom"><div class="time-pair"><div class="time-block"><span>${old ? "上次預報" : "預計上車"}</span><strong>${hkTime(next.eta)}</strong></div><span class="time-arrow" aria-hidden="true">→</span><div class="time-block"><span>估算抵達</span><strong>${old ? "—" : arrivalTime(next)}</strong></div></div><span class="ride-tag">車程約 ${rideRange(next)} 分鐘</span></div>`,
    );
  }
  setMarkup(
    "trips",
    board
      .slice(1)
      .map((r) => {
        const src = sourceLabel(r, now);
        return `<article class="trip-row" aria-label="${esc(r.route)} ${hkTime(r.eta)} ${src.label}">${badge(r)}<div class="trip-info"><strong>${hkTime(r.eta)}<span aria-hidden="true">→</span>${src.className === "stale" ? "—" : arrivalTime(r)}</strong><p>${src.label}${r.route === "74K" || r.route === "75F" ? " · " + esc(r.variant || variantLabel(r.route, r.service)) : ""}</p>${r.boardStop ? `<p class="platform-note">上車：${esc(r.boardStop)}</p>` : ""}</div><div class="trip-wait">${src.className === "stale" ? "待更新" : `<strong>${waitMinutes(r.eta, now)}</strong>分鐘`}</div></article>`;
      })
      .join("") ||
      `<p class="empty-list">${loading ? "正在尋找班次…" : next ? "暫未有後續班次，稍後自動更新" : "有新的到站預報時，班次會在這裡顯示。"}</p>`,
  );
  setMarkup(
    "arrivals",
    arrivals
      .map((r) => {
        const src = sourceLabel(r, now);
        return `<div class="arrival-item">${badge(r)}<span>${hkTime(r.eta)} <small>· ${src.label}${r.alightStop ? " · " + esc(r.alightStop) : ""}</small></span><strong>${src.className === "stale" ? "待更新" : waitMinutes(r.eta, now) + " 分鐘"}</strong></div>`;
      })
      .join("") || '<p class="empty-list">落車站暫未有到站預報</p>',
  );
  const sources = feeds
    .filter((f) => f?.json)
    .map((f) => f.sourceAt)
    .filter(Number.isFinite);
  text(
    "updated",
    sources.length
      ? `資料時間 ${hkTime(Math.min(...sources), true)}${failed ? " · 更新失敗" : ""}`
      : state.loaded
        ? "未取得有效資料"
        : "等待首次更新",
  );
  const remaining = Math.max(
    0,
    Math.ceil((state.lastAttempt + REFRESH_MS - now) / 1000),
  );
  text(
    "nextRefresh",
    state.busy
      ? "正在更新…"
      : offline
        ? "等待重新連線"
        : `${remaining} 秒後更新`,
  );
  $("refreshProgress").style.width =
    `${Math.min(100, ((now - state.lastAttempt) / REFRESH_MS) * 100)}%`;
}
function changeJourney(reset = false) {
  if (!selectionReady) return;
  beginJourneyMotion();
  setupJourney({ reset });
  animateIn(document.querySelector(".station-fields"), 4, 440, 3);
  animateJourneyPath();
  state.loaded = false;
  state.lastSuccess = 0;
  refresh({ replace: true });
  lightSweep($("hero"));
}

document.querySelectorAll("[data-route]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.route === state.route) return;
    setJourneyDrift(b.dataset.route === "56" ? -1 : 1);
    state.route = b.dataset.route;
    state.mode = "auto";
    state.direction = "out";
    changeJourney(true);
  }),
);
document.querySelectorAll("[data-direction]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.direction === state.direction) return;
    setJourneyDrift(b.dataset.direction === "out" ? -1 : 1);
    state.direction = b.dataset.direction;
    changeJourney(true);
  }),
);
$("variant").addEventListener("change", () => {
  state.mode = $("variant").value;
  state.ride = null;
  state.ride75 = null;
  changeJourney();
});
$("board").addEventListener("change", () => {
  state.boardId = $("board").value;
  state.ride = null;
  state.ride75 = null;
  changeJourney();
});
$("alight").addEventListener("change", () => {
  state.alightId = $("alight").value;
  state.ride = null;
  state.ride75 = null;
  changeJourney();
});
$("ride").addEventListener("change", () => {
  if (!$("ride").checkValidity() || !$("ride").value) {
    $("ride").reportValidity();
    updateRide();
    return;
  }
  state.ride = Number($("ride").value);
  updateRide();
  render();
});
$("ride75").addEventListener("change", () => {
  if (!$("ride75").checkValidity() || !$("ride75").value) {
    $("ride75").reportValidity();
    updateRide();
    return;
  }
  state.ride75 = Number($("ride75").value);
  updateRide();
  render();
});
$("resetRide").addEventListener("click", () => {
  state.ride = null;
  state.ride75 = null;
  updateRide();
  render();
});
$("refresh").addEventListener("click", () =>
  selectionReady ? refresh() : boot(),
);
window.addEventListener("online", () => {
  if (selectionReady) {
    refresh({ replace: true });
    updateMetadata();
  } else boot();
});
window.addEventListener("offline", render);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    tick(true);
    updateMetadata();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) tick(true);
});

// Keep bundled station names, refresh sequences from KMB, and fetch names for new stops.
let metadataBusy = false;
let metadataAttempt = 0;
async function updateMetadata() {
  if (
    metadataBusy ||
    Date.now() - state.metadataChecked < 86400000 ||
    !navigator.onLine
  )
    return;
  metadataBusy = true;
  metadataAttempt = Date.now();
  try {
    const known = new Map(
      state.routes.flatMap((v) => v.stops).map((s) => [s.id, s]),
    );
    const results = await Promise.all(
      state.routes.map(async (v) => {
        const direction = v.bound === "O" ? "outbound" : "inbound";
        const json = await getJSON(
          apiURL("KMB", `route-stop/${v.route}/${direction}/${v.service}`),
        );
        if (!json.data.length) throw new Error("未有站序");
        const stops = await Promise.all(
          json.data.map(async (r) => {
            let stop = known.get(r.stop);
            if (!stop) {
              const response = await fetch(apiURL("KMB", `stop/${r.stop}`), {
                cache: "no-store",
                signal: AbortSignal.timeout(12000),
              });
              if (!response.ok) throw new Error("車站讀取失敗");
              const { data } = await response.json();
              if (!data?.name_tc) throw new Error("車站格式不正確");
              stop = {
                id: r.stop,
                name: data.name_tc,
                lat: Number(data.lat),
                lng: Number(data.long),
              };
            }
            return { ...stop, seq: Number(r.seq) };
          }),
        );
        if (stops.at(-1).id === stops[0].id) stops.pop();
        return { ...v, stops };
      }),
    );
    state.routes = results;
    state.metadataChecked = Date.now();
    state.metadataWarning = false;
    if (selectionReady && state.route !== "56") {
      setupJourney();
      refresh({ replace: true });
    }
  } catch {
    state.metadataWarning = true;
  } finally {
    metadataBusy = false;
    render();
  }
}
function tick(force = false) {
  if (document.hidden) return;
  if (
    selectionReady &&
    state.route === "74K" &&
    state.mode === "auto" &&
    baseVariant.service !== auto74Service()
  ) {
    state.ride = null;
    setupJourney();
    refresh({ replace: true });
    return;
  }
  render();
  if (selectionReady && (force || Date.now() - state.lastAttempt >= REFRESH_MS))
    refresh({ replace: force });
  if (selectionReady && Date.now() - metadataAttempt > 60000) updateMetadata();
}
async function boot() {
  $("refresh").disabled = true;
  try {
    const response = await fetch("./routes.json", {
      cache: "no-cache",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("車站資料讀取失敗");
    const data = await response.json();
    if (!Array.isArray(data.routes) || !data.routes.length)
      throw new Error("車站資料格式不正確");
    state.routes = data.routes.map((v) => ({
      ...v,
      stops:
        v.stops.at(-1).id === v.stops[0].id ? v.stops.slice(0, -1) : v.stops,
    }));
    setupJourney();
    refresh();
    updateMetadata();
  } catch {
    $("hero").className = "island empty-island";
    setMarkup(
      "hero",
      "<h3>未能載入行程</h3><p>請確認網絡連線，再按「更新」重試。</p>",
    );
    text("connection", "連線失敗");
    $("connection").classList.add("warning");
    $("refresh").disabled = false;
  }
}
setInterval(() => tick(), 1000);
boot();
