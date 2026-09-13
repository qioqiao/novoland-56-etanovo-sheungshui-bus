import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = { black: "#101010", red: "#E60012", white: "#F5F0E6" };

// One shared 32-unit vector drawing feeds the favicon and every PNG.
// The red paper badge has four straight edges; no pre-rounded OS icon mask.
const halfStroke = 1.75;
const diagonal = halfStroke * Math.SQRT2;
const artwork = [
  { color: palette.black, points: [[0, 0], [32, 0], [32, 32], [0, 32]] },
  { color: palette.white, points: [[2, 7], [27, 2], [30, 26], [5, 30]] },
  { color: palette.red, points: [[4, 8.5], [25.5, 4], [27.7, 24.5], [6.5, 27.7]] },
  // Squared, bold up-right arrow, based on M9 23 23 9 M10 9h13v13.
  { color: palette.white, points: [[9 - diagonal, 23], [23 - halfStroke / Math.SQRT2, 9 - halfStroke / Math.SQRT2], [23 + halfStroke / Math.SQRT2, 9 + halfStroke / Math.SQRT2], [9, 23 + diagonal]] },
  { color: palette.white, points: [[8.25, 7.25], [24.75, 7.25], [24.75, 10.75], [8.25, 10.75]] },
  { color: palette.white, points: [[21.25, 7.25], [24.75, 7.25], [24.75, 23.75], [21.25, 23.75]] },
].map((shape, index) => ({ ...shape, points: index >= 3 ? shape.points.map(point => point.map(value => 16 + (value - 16) * .9)) : shape.points, rgb: shape.color.slice(1).match(/../g).map(hex => parseInt(hex, 16)) }));

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = (x + (sx + .5) / samples) * 32 / size;
      const py = (y + (sy + .5) / samples) * 32 / size;
      let color = artwork[0].rgb;
      for (const shape of artwork.slice(1)) if (insidePolygon(px, py, shape.points)) color = shape.rgb;
      for (let channel = 0; channel < 3; channel++) sum[channel] += color[channel];
    }
    const index = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.round(sum[channel] / samples ** 2);
    pixels[index + 3] = 255;
  }
  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function toPng(size) {
  const pixels = render(size);
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(size * rowBytes);
  for (let y = 0; y < size; y++) pixels.copy(raw, y * rowBytes + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pointList = points => points.map(point => point.map(value => Number(value.toFixed(8))).join(",")).join(" ");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${artwork.map(shape => `<polygon points="${pointList(shape.points)}" fill="${shape.color}"/>`).join("")}</svg>\n`;
writeFileSync(join(root, "favicon.svg"), svg);
console.log("favicon.svg: shared angular up-right arrow, black/red/warm white");
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  writeFileSync(join(root, name), toPng(size));
  console.log(`${name}: ${size} × ${size}, opaque RGBA`);
}
