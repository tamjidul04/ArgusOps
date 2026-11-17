// Draws the app icon (an evergreen rounded square with a ring) as a PNG, so the repository needs no image files.
// electron-builder turns it into the Windows icon. Run by `npm run dist`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const N = 512;
const px = Buffer.alloc(N * N * 4);
const radius = N * 0.22;
const cx = (N - 1) / 2;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    // rounded square, anti-aliased edge
    const dx = Math.max(Math.abs(x - cx) - (N / 2 - radius - 8), 0);
    const dy = Math.max(Math.abs(y - cx) - (N / 2 - radius - 8), 0);
    const edge = radius - Math.hypot(dx, dy);
    const a = Math.max(0, Math.min(1, edge + 0.5));
    // evergreen with a faint top-to-bottom shade
    const t = y / N;
    let r = 0x1f + 10 * (1 - t), g = 0x3d + 14 * (1 - t), b = 0x37 + 12 * (1 - t);
    // the ring
    const d = Math.hypot(x - cx, y - cx);
    const ring = Math.max(0, Math.min(1, 1 - Math.abs(d - N * 0.2) / 14 + 0.5));
    r = r + (255 - r) * ring;
    g = g + (255 - g) * ring;
    b = b + (255 - b) * ring;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = Math.round(255 * a);
  }
}
// PNG: signature, IHDR, IDAT (filter 0 per row), IEND
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = resolve(here, "build/icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("icon", out, png.length, "bytes");
