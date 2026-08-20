import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8756;
const CTB = "https://rt.data.gov.hk/v2/transport/citybus";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function isSafeRel(rel) {
  const resolved = path.resolve(ROOT, rel);
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  rel = rel.replace(/^\/+/, "");
  if (!isSafeRel(rel) || rel.includes("\0")) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  const filePath = path.join(ROOT, rel);
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { "Content-Type": MIME[ext] || "application/octet-stream" });
  } catch {
    json(res, 404, { error: "not found" });
  }
}

function ctbTarget(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "proxy" || parts[1] !== "ctb" || parts[2] !== "eta") return null;
  const stop = parts[3] || "";
  const route = parts[4] || "";
  if (!/^[A-Za-z0-9]+$/.test(stop) || !/^[A-Za-z0-9]+$/.test(route) || parts.length !== 5) {
    return null;
  }
  return `${CTB}/eta/CTB/${stop}/${route}`;
}

async function proxy(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = ctbTarget(url.pathname);
  if (!target) {
    json(res, 400, { error: "blocked or invalid proxy request" });
    return;
  }
  try {
    const upstream = await fetch(target, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const text = await upstream.text();
    send(res, upstream.status, text, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
  } catch (err) {
    json(res, 502, { error: "upstream failed", detail: String(err.message || err) });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/proxy/")) {
      await proxy(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (err) {
    json(res, 500, { error: "server error", detail: String(err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`城巴 56／56A：http://127.0.0.1:${PORT}/`);
});
