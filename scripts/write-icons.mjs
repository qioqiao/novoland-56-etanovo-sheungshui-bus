import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x12, 0x14, 0x16, 0xff];
const BLUE = [0x1f, 0x6f, 0xeb, 0xff];
const ORANGE = [0xe8, 0x5d, 0x04, 0xff];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function coverageRoundRect(px, py, x, y, w, h, r) {
  const samples = 4;
  let hit = 0;
  const step = 1 / samples;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const qx = px + (sx + 0.5) * step;
      const qy = py + (sy + 0.5) * step;
      if (insideRoundRect(qx, qy, x, y, w, h, r)) hit++;
    }
  }
  return hit / (samples * samples);
}

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const rr = Math.min(r, w / 2, h / 2);
  const cx = px < x + rr ? x + rr : px > x + w - rr ? x + w - rr : px;
  const cy = py < y + rr ? y + rr : py > y + h - rr ? y + h - rr : py;
  if (cx === px && cy === py) return true;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rr * rr;
}

function blend(dst, src, a) {
  if (a <= 0) return dst;
  if (a >= 1) return src.slice();
  const ia = 1 - a;
  return [
    Math.round(dst[0] * ia + src[0] * a),
    Math.round(dst[1] * ia + src[1] * a),
    Math.round(dst[2] * ia + src[2] * a),
    255,
  ];
}

function paintRoundRect(pixels, size, x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(size, Math.ceil(x + w));
  const y1 = Math.min(size, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const a = coverageRoundRect(px, py, x, y, w, h, r);
      if (a <= 0) continue;
      const i = (py * size + px) * 4;
      const dst = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      const out = blend(dst, color, a);
      pixels[i] = out[0];
      pixels[i + 1] = out[1];
      pixels[i + 2] = out[2];
      pixels[i + 3] = out[3];
    }
  }
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 32;
  // iOS applies its own squircle mask. Keep the bitmap fully opaque and square.
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = BG[0];
    pixels[i * 4 + 1] = BG[1];
    pixels[i * 4 + 2] = BG[2];
    pixels[i * 4 + 3] = BG[3];
  }
  const segments = [
    [9, 23, 23, 9],
    [10, 9, 23, 9],
    [23, 9, 23, 22],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = (x + (sx + 0.5) / 4) / s,
            py = (y + (sy + 0.5) / 4) / s;
          if (
            segments.some(([ax, ay, bx, by]) => {
              const dx = bx - ax,
                dy = by - ay;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy),
                ),
              );
              return Math.hypot(px - ax - t * dx, py - ay - t * dy) <= 1.75;
            })
          )
            hits++;
        }
      const i = (y * size + x) * 4;
      const color = blend(BG, [185, 245, 103, 255], hits / 16);
      for (let c = 0; c < 4; c++) pixels[i + c] = color[c];
    }
  return pixels;
}

function toPng(size) {
  const pixels = render(size);
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

for (const [name, size] of files) {
  const out = join(root, name);
  writeFileSync(out, toPng(size));
  console.log(name, size);
}
