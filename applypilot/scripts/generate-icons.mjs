/**
 * Generates ApplyPilot's PNG icons (no external deps — hand-rolled PNG encoder).
 *
 * Design: brand-blue rounded square with a white "play/run" triangle, matching
 * the extension's primary Run action. Run with: `node scripts/generate-icons.mjs`
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'icons');
mkdirSync(OUT, { recursive: true });

const BLUE = [0x25, 0x57, 0xa7, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const CLEAR = [0, 0, 0, 0];

// --- CRC32 (PNG chunk checksums) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pointInTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  const c = 1 - a - b;
  return a >= 0 && b >= 0 && c >= 0;
}

function encodePng(size) {
  const radius = size * 0.18;
  const m = size * 0.30;
  const A = [m, m];
  const B = [m, size - m];
  const C = [size - m * 0.85, size / 2];

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte (none)
    for (let x = 0; x < size; x++) {
      // Rounded-corner mask -> transparent outside.
      let px = WHITE;
      const inCornerCut =
        (x < radius && y < radius && dist(x, y, radius, radius) > radius) ||
        (x > size - radius && y < radius && dist(x, y, size - radius, radius) > radius) ||
        (x < radius && y > size - radius && dist(x, y, radius, size - radius) > radius) ||
        (x > size - radius && y > size - radius && dist(x, y, size - radius, size - radius) > radius);
      if (inCornerCut) px = CLEAR;
      else if (pointInTriangle(x + 0.5, y + 0.5, A, B, C)) px = WHITE;
      else px = BLUE;
      raw[p++] = px[0];
      raw[p++] = px[1];
      raw[p++] = px[2];
      raw[p++] = px[3];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function dist(x, y, cx, cy) {
  return Math.hypot(x - cx, y - cy);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon${size}.png`), encodePng(size));
  console.log(`wrote icons/icon${size}.png`);
}
