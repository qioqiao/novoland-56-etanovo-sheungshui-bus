import { writeFile } from "node:fs/promises";
const base = "https://data.etabus.gov.hk/v1/transport/kmb";
const get = async (path) => {
  const res = await fetch(`${base}/${path}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${path}`);
  return (await res.json()).data;
};
const stops = new Map((await get("stop")).map((s) => [s.stop, s]));
const variants = [
  ["74K", "outbound", 1],
  ["74K", "outbound", 2],
  ["75F", "outbound", 1],
  ["75F", "outbound", 2],
  ["75F", "inbound", 1],
];
const routes = await Promise.all(
  variants.map(async ([route, direction, service]) => ({
    route,
    direction,
    service,
    bound: direction === "outbound" ? "O" : "I",
    stops: (await get(`route-stop/${route}/${direction}/${service}`)).map(
      (r) => {
        const s = stops.get(r.stop);
        if (!s) throw new Error(`Missing stop ${r.stop}`);
        return {
          seq: Number(r.seq),
          id: r.stop,
          name: s.name_tc,
          lat: Number(s.lat),
          lng: Number(s.long),
        };
      },
    ),
  })),
);
await writeFile(
  new URL("../routes.json", import.meta.url),
  JSON.stringify(
    { checkedAt: new Date().toISOString(), source: base, routes },
    null,
    2,
  ),
);
console.log(
  routes
    .map((r) => `${r.route}/${r.bound}/${r.service}: ${r.stops.length} stops`)
    .join("\n"),
);
