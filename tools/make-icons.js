// 앱 아이콘 PNG 생성 (외부 라이브러리 없이): node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const YELLOW = [255, 208, 0], BROWN = [74, 44, 18], WHITE = [255, 255, 255];
const star = (cx, cy, R, r) => Array.from({ length: 8 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 4, d = i % 2 ? r : R;
  return [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
});
// 64x64 좌표계의 도형 (나중 것이 위에 그려짐)
const SHAPES = [
  [BROWN, [[16, 30], [32, 17], [48, 30], [48, 49], [16, 49]]],
  [YELLOW, star(32, 37, 7.2, 2.2)],
  [WHITE, star(48, 13.8, 4.8, 1.4)],
];

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function render(size, scale) {
  const ss = 4, px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      // 픽셀 → 64 좌표계 (가운데 기준으로 scale 만큼 축소해 마스커블 안전영역 확보)
      const u = ((x + (sx + .5) / ss) / size * 64 - 32) / scale + 32;
      const v = ((y + (sy + .5) / ss) / size * 64 - 32) / scale + 32;
      let c = YELLOW;
      for (const [col, poly] of SHAPES) if (inside([u, v], poly)) c = col;
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const o = (y * size + x) * 3;
    for (let k = 0; k < 3; k++) px[o + k] = Math.round(acc[k] / (ss * ss));
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'app', 'icons');
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${s}.png`), render(s, 0.72));
  console.log(`icon-${s}.png`);
}
