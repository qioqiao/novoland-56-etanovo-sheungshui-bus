import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8756;
const publicFiles = new Set([
  "index.html",
  "inbound.html",
  "app.js",
  "motion.js",
  "motion.css",
  "launch.js",
  "launch.css",
  "model.js",
  "styles.css",
  "routes.json",
  "manifest.json",
  "favicon.svg",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
};
export function proxyTarget(pathname) {
  let m = pathname.match(
    /^\/proxy\/ctb\/eta\/(?:CTB\/)?(003767|003378|003849|003753)\/(56|56A)$/,
  );
  if (m)
    return `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${m[1]}/${m[2]}`;
  m = pathname.match(
    /^\/proxy\/kmb\/(route-eta\/(?:74K|75F)\/[12]|route-stop\/(?:74K|75F)\/(?:outbound|inbound)\/[12]|stop\/[A-F0-9]{16})$/,
  );
  return m ? `https://data.etabus.gov.hk/v1/transport/kmb/${m[1]}` : null;
}
export const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      send(res, 405, JSON.stringify({ error: "method not allowed" }));
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/proxy/")) {
      const target = proxyTarget(url.pathname);
      if (!target) {
        send(res, 400, JSON.stringify({ error: "invalid proxy request" }));
        return;
      }
      try {
        const upstream = await fetch(target, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        send(res, upstream.status, await upstream.text());
      } catch {
        send(res, 502, JSON.stringify({ error: "upstream unavailable" }));
      }
      return;
    }
    const rel = decodeURIComponent(
      url.pathname === "/" ? "index.html" : url.pathname.slice(1),
    );
    if (!publicFiles.has(rel)) {
      send(res, 404, JSON.stringify({ error: "not found" }));
      return;
    }
    send(
      res,
      200,
      await fs.readFile(path.join(ROOT, rel)),
      MIME[path.extname(rel)],
    );
  } catch {
    send(res, 500, JSON.stringify({ error: "server error" }));
  }
});
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  server.listen(PORT, "127.0.0.1", () =>
    console.log(`就到站：http://127.0.0.1:${PORT}/`),
  );
