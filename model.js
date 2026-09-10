export const REFRESH_MS = 30000;
export const STALE_MS = 120000;
export const EXPIRE_MS = 300000;
export const hkParts = (now = Date.now()) => {
  const d = new Date(Number(now) + 8 * 3600000);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    day: d.getUTCDay(),
  };
};
export const hkTime = (value, seconds = false) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(new Date(value));
// A 00:10 departure belongs to the previous afternoon service.
export const auto74Service = (now = Date.now()) => {
  const { hour } = hkParts(now);
  return hour >= 3 && hour < 12 ? 1 : 2;
};
export const cleanName = (name) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();
export const waitMinutes = (eta, now = Date.now()) =>
  Math.max(0, Math.ceil((eta - now) / 60000));
export const isScheduled = (row) =>
  /原定|預定|scheduled/i.test(`${row.rmk_tc || ""} ${row.rmk_en || ""}`);
export function parseEta(
  payload,
  { operator, route, bound, service, seq, destRe },
  now = Date.now(),
) {
  if (!payload || !Array.isArray(payload.data))
    throw new Error("到站資料格式不正確");
  const seen = new Set();
  return payload.data
    .filter(
      (r) =>
        r.route === route &&
        r.dir === bound &&
        (operator !== "KMB" ||
          (Number(r.service_type) === service && Number(r.seq) === seq)) &&
        (!destRe || destRe.test(`${r.dest_tc || ""} ${r.dest_en || ""}`)),
    )
    .map((r) => ({
      route,
      bound,
      service,
      seq,
      eta: Date.parse(r.eta),
      sourceAt: Date.parse(
        r.data_timestamp ||
          payload.data_timestamp ||
          payload.generated_timestamp,
      ),
      scheduled: isScheduled(r),
      remark: r.rmk_tc || "",
      destination: r.dest_tc || "",
    }))
    .filter(
      (r) =>
        Number.isFinite(r.eta) &&
        r.eta >= now - 15000 &&
        Number.isFinite(r.sourceAt) &&
        r.sourceAt <= now + 60000 &&
        now - r.sourceAt < EXPIRE_MS,
    )
    .sort((a, b) => a.eta - b.eta)
    .filter((r) => {
      const key = `${r.route}/${r.service}/${r.eta}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function findPair(stops, boardId, alightId) {
  const board = stops.find((s) => s.id === boardId);
  const alight = stops.find(
    (s) => s.id === alightId && s.seq > (board?.seq ?? Infinity),
  );
  return board && alight ? { board, alight } : null;
}
// Group destinations, not physical boarding bays: each route retains its own stop ID.
export function journeyStopKey(stop) {
  if (/大埔墟站/.test(stop.name)) return "tai-po-market";
  if (/教育大學/.test(stop.name)) return "eduhk";
  return stop.id;
}
export function findJourneyPair(stops, boardKey, alightKey) {
  const board = stops.find((s) => journeyStopKey(s) === boardKey);
  const alight = stops.find(
    (s) => journeyStopKey(s) === alightKey && s.seq > (board?.seq ?? Infinity),
  );
  return board && alight ? { board, alight } : null;
}
export function defaultRide(
  route,
  direction,
  service,
  pair,
  stops,
  now = Date.now(),
) {
  if (route === "56") {
    const { hour, day } = hkParts(now);
    return day > 0 &&
      day < 6 &&
      ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19))
      ? 42
      : 35;
  }
  const board = cleanName(pair.board.name),
    alight = cleanName(pair.alight.name);
  if (/大埔墟站/.test(board) && /教育大學/.test(alight))
    return route === "74K"
      ? service === 1
        ? 28
        : 48
      : service === 2
        ? 28
        : 20;
  if (/教育大學/.test(board) && /大埔墟站/.test(alight))
    return route === "74K" ? (service === 1 ? 48 : 28) : 20;
  return Math.max(
    3,
    Math.round(
      (pair.alight.seq - pair.board.seq) * (route === "75F" ? 4 : 2.2),
    ),
  );
}
export function variantLabel(route, service) {
  return route === "74K"
    ? service === 1
      ? "中午前 · 先經教大"
      : "中午後 · 先經三門仔"
    : route === "75F"
      ? service === 2
        ? "經大埔工業邨"
        : "一般特快班次"
      : "NOVO LAND ↔ 上水";
}
export function freshness(sourceAt, now = Date.now()) {
  if (
    !Number.isFinite(sourceAt) ||
    sourceAt > now + 60000 ||
    now - sourceAt >= EXPIRE_MS
  )
    return "expired";
  return now - sourceAt >= STALE_MS ? "stale" : "fresh";
}

// KMB can duplicate a shared-stop ETA under both requested service types.
// Never count these as separate buses or pretend that the API identified a vehicle.
export function reconcileKmb(rows, { route, mode = "auto", atOrigin = false }) {
  const groups = new Map();
  for (const row of rows) {
    if (route === "74K" && atOrigin && row.service !== auto74Service(row.eta))
      continue;
    const key = `${row.bound}/${row.eta}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((list) => {
      const services = [...new Set(list.map((r) => r.service))].sort();
      if (mode !== "auto" && !services.includes(Number(mode))) return null;
      const row =
        list.find((r) => mode !== "auto" && r.service === Number(mode)) ||
        list[0];
      return {
        ...row,
        services,
        rideMin: Math.min(...list.map((r) => r.ride)),
        rideMax: Math.max(...list.map((r) => r.ride)),
        sourceAt: Math.min(...list.map((r) => r.sourceAt)),
        failed: list.some((r) => r.failed),
        variant:
          services.length > 1
            ? "行車版本未確認"
            : variantLabel(route, services[0]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.eta - b.eta);
}
