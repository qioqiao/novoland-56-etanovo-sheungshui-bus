import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  auto74Service,
  hkTime,
  parseEta,
  findPair,
  journeyStopKey,
  findJourneyPair,
  defaultRide,
  freshness,
  reconcileKmb,
  waitMinutes,
} from "../model.js";
import { proxyTarget } from "../server.mjs";
const time = (s) => Date.parse(`2026-09-10T${s}+08:00`);
const now = time("11:59:00");
const row = {
  route: "74K",
  dir: "O",
  service_type: 1,
  seq: 12,
  eta: "2026-09-10T12:10:00+08:00",
  data_timestamp: "2026-09-10T11:59:00+08:00",
  rmk_tc: "",
};
const cfg = { operator: "KMB", route: "74K", bound: "O", service: 1, seq: 12 };
const snapshot = JSON.parse(
  (await readFile(new URL("../routes.json", import.meta.url), "utf8")).replace(
    /^\uFEFF/,
    "",
  ),
);
const variants = snapshot.routes.filter((v) => v.route === "74K");
test("74K Hong Kong noon boundary and midnight tail departures", () => {
  assert.equal(auto74Service(time("11:59:59")), 1);
  assert.equal(auto74Service(time("12:00:00")), 2);
  assert.equal(auto74Service(time("00:10:00")), 2);
  assert.equal(auto74Service(time("06:00:00")), 1);
  assert.equal(hkTime(Date.parse("2026-09-10T04:00:00Z")), "12:00");
});
test("official 74K sequences distinguish the university before/after Sam Mun Tsai", () => {
  for (const v of variants) {
    const edu = v.stops.find((s) => /教育大學/.test(s.name));
    const sam = v.stops.find((s) => /^三門仔 \(/.test(s.name));
    assert.equal(edu.seq < sam.seq, v.service === 1);
  }
  assert.equal(variants[0].stops.find((s) => /教育大學/.test(s.name)).seq, 12);
  assert.equal(variants[1].stops.find((s) => /教育大學/.test(s.name)).seq, 23);
});
test("KMB filters direction, sequence, service, invalid and stale ETAs", () => {
  const payload = {
    data: [
      row,
      { ...row, dir: "I" },
      { ...row, seq: 23 },
      { ...row, service_type: 2 },
      { ...row, eta: null },
      { ...row, eta: "invalid" },
      { ...row, data_timestamp: "2026-09-10T11:50:00+08:00" },
      { ...row, data_timestamp: "2026-09-10T12:30:00+08:00" },
    ],
  };
  assert.equal(parseEta(payload, cfg, now).length, 1);
});
test("malformed API payload cannot masquerade as no-service success", () =>
  assert.throws(() => parseEta({ error: "oops" }, cfg, now)));
test("scheduled data retains its source label and past trips are removed", () => {
  const rows = parseEta(
    {
      data: [
        { ...row, rmk_tc: "原定班次" },
        { ...row, eta: "2026-09-10T11:57:00+08:00" },
      ],
    },
    cfg,
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scheduled, true);
});
test("duplicate ETAs removed within a service", () =>
  assert.equal(parseEta({ data: [row, row] }, cfg, now).length, 1));
test("CTB inbound filter excludes wrong direction and destination", () => {
  const rows = parseEta(
    {
      generated_timestamp: new Date(now).toISOString(),
      data: [
        { ...row, route: "56", dir: "I", dest_tc: "屯門(菁田邨)" },
        { ...row, route: "56", dir: "O", dest_tc: "天平邨" },
      ],
    },
    { operator: "CTB", route: "56", bound: "I", destRe: /屯門/ },
    now,
  );
  assert.equal(rows.length, 1);
});
test("stale and expiry boundaries suppress false freshness", () => {
  assert.equal(freshness(now - 119999, now), "fresh");
  assert.equal(freshness(now - 120000, now), "stale");
  assert.equal(freshness(now - 300000, now), "expired");
  assert.equal(freshness(NaN, now), "expired");
});
test("boarding and alighting must follow the actual circular sequence", () => {
  const stops = variants[0].stops;
  const edu = stops.find((s) => /教育大學/.test(s.name));
  const pair = findPair(stops, edu.id, stops[0].id);
  assert.equal(pair.alight.seq, 36);
  assert.equal(findPair(stops, edu.id, stops[1].id), null);
});
test("different 74K directions and versions change the ride estimate", () => {
  for (const v of variants) {
    const edu = v.stops.find((s) => /教育大學/.test(s.name));
    const out = findPair(v.stops, v.stops[0].id, edu.id);
    const inbound = findPair(v.stops, edu.id, v.stops.at(-2).id);
    assert.equal(
      defaultRide("74K", "out", v.service, out, v.stops, now),
      v.service === 1 ? 28 : 48,
    );
    assert.equal(
      defaultRide("74K", "in", v.service, inbound, v.stops, now),
      v.service === 1 ? 48 : 28,
    );
  }
});
const duplicateRows = (eta = time("23:40:00")) =>
  [1, 2].map((service) => ({
    route: "74K",
    bound: "O",
    service,
    eta,
    ride: service === 1 ? 28 : 48,
    sourceAt: now,
  }));
test("shared origin 74K ETAs are deduplicated using departure time", () => {
  const result = reconcileKmb(duplicateRows(), {
    route: "74K",
    atOrigin: true,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].service, 2);
  assert.equal(
    reconcileKmb(duplicateRows(), { route: "74K", mode: "1", atOrigin: true })
      .length,
    0,
  );
});
test("noon boundary retains each real departure once with the right service", () => {
  const result = reconcileKmb(
    [...duplicateRows(time("11:59:00")), ...duplicateRows(time("12:20:00"))],
    { route: "74K", atOrigin: true },
  );
  assert.deepEqual(
    result.map((r) => r.service),
    [1, 2],
  );
});
test("uncertain shared-stop versions become one bus with an honest estimate range", () => {
  const result = reconcileKmb(duplicateRows(), { route: "74K" });
  assert.equal(result.length, 1);
  assert.equal(result[0].variant, "行車版本未確認");
  assert.equal(result[0].rideMin, 28);
  assert.equal(result[0].rideMax, 48);
});
test("75F duplicate common-stop ETAs also collapse, including manual mode", () => {
  const result = reconcileKmb(
    duplicateRows().map((r) => ({ ...r, route: "75F" })),
    { route: "75F", mode: "2" },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].services.length, 2);
});
test("countdown uses ceiling so a bus 70 seconds away is not shown as 1 minute", () =>
  assert.equal(waitMinutes(now + 70000, now), 2));
test("proxy allowlist permits only requested official APIs", () => {
  assert.match(
    proxyTarget("/proxy/kmb/route-eta/74K/2"),
    /^https:\/\/data.etabus.gov.hk/,
  );
  assert.match(
    proxyTarget("/proxy/ctb/eta/CTB/003767/56"),
    /^https:\/\/rt.data.gov.hk/,
  );
  for (const path of [
    "/proxy/kmb/https://example.com",
    "/proxy/kmb/route-eta/999/1",
    "/proxy/ctb/eta/CTB/000001/56",
    "/proxy/kmb/../../.git/config",
  ])
    assert.equal(proxyTarget(path), null);
});

test("merged destinations preserve distinct physical boarding bays", () => {
  const routes = snapshot.routes;
  for (const route of ["74K", "75F"]) {
    const v = routes.find(
      (v) => v.route === route && v.bound === "O" && v.service === 1,
    );
    const pair = findJourneyPair(v.stops, "tai-po-market", "eduhk");
    assert.equal(journeyStopKey(pair.board), "tai-po-market");
    assert.equal(
      pair.board.id,
      route === "74K" ? "94A3E9298FD887C6" : "8581908CE476D2CF",
    );
    assert.equal(
      pair.alight.id,
      route === "74K" ? "081EB225028BC80B" : "DA9843B8F12ED700",
    );
  }
});
test("merged return journey uses each route own university bay and downstream terminal", () => {
  for (const route of ["74K", "75F"]) {
    const v = snapshot.routes.find(
      (v) =>
        v.route === route &&
        v.bound === (route === "74K" ? "O" : "I") &&
        v.service === 1,
    );
    const pair = findJourneyPair(v.stops, "eduhk", "tai-po-market");
    assert.ok(pair.alight.seq > pair.board.seq);
    assert.equal(pair.alight.id, "46604706EE6CC765");
  }
});
test("shared destination does not make unserved industrial stops valid for 74K", () => {
  const v = snapshot.routes.find((v) => v.route === "74K");
  assert.equal(findJourneyPair(v.stops, "4705F639E370A9AD", "eduhk"), null);
});
