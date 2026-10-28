// Rendert eine Karte als PNG zur Kontrolle: npx tsx scripts/mapimg.ts grenzstadt out.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildMap } from '../src/shared/map/maps';
import { T } from '../src/shared/map/tiles';
import { TILE } from '../src/shared/constants';

const id = process.argv[2] ?? 'grenzstadt';
const out = process.argv[3] ?? `${id}.png`;
const S = 4;
const m = buildMap(id);
const W = m.w * S;
const H = m.h * S;
const px = new Uint8Array(W * H * 4);
const col: Record<number, [number, number, number]> = {
  [T.GRASS]: [62, 84, 52], [T.DIRT]: [96, 80, 58], [T.ASPHALT]: [52, 54, 58], [T.CONCRETE]: [118, 118, 112],
  [T.WOOD]: [120, 88, 60], [T.TILEFLOOR]: [150, 150, 140], [T.INDOOR]: [100, 100, 96], [T.SAND]: [170, 160, 120],
  [T.WATER]: [40, 70, 110], [T.GRAVEL]: [110, 104, 94], [T.WALL]: [30, 26, 24], [T.WALL_CONCRETE]: [24, 24, 28],
  [T.WALL_METAL]: [40, 50, 60], [T.FENCE]: [200, 200, 200], [T.WINDOW]: [120, 200, 240], [T.LOW]: [150, 110, 60],
  [T.TREE]: [20, 50, 20], [T.BUSH]: [40, 110, 40], [T.DOOR_LOCKED]: [230, 40, 40], [T.ROCK]: [90, 90, 90],
  [T.BORDER]: [10, 20, 10], [T.RAIL]: [80, 70, 60], [T.CARPET]: [90, 50, 50], [T.METALFLOOR]: [80, 90, 100], [T.DOCK]: [110, 90, 70],
};
const put = (x: number, y: number, c: [number, number, number]) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
};
for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
  const c = col[m.get(tx, ty)] ?? [255, 0, 255];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(tx * S + x, ty * S + y, c);
}
const dot = (wx: number, wy: number, c: [number, number, number], r = 2) => {
  const cx = Math.round((wx / TILE) * S), cy = Math.round((wy / TILE) * S);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) put(cx + x, cy + y, c);
};
for (const c of m.containers) dot((c.tx + 0.5) * TILE, (c.ty + 0.5) * TILE, c.tier >= 3 ? [255, 60, 255] : [255, 220, 0], 1);
for (const e of m.extracts) dot(e.x, e.y, [0, 255, 120], 4);
for (const s of m.playerSpawns) dot(s.x, s.y, [0, 160, 255], 3);
for (const s of m.botSpawns) dot(s.x, s.y, s.kind === 'pmc' ? [255, 120, 0] : [255, 30, 30], 2);
if (m.boss) dot(m.boss.x, m.boss.y, [255, 255, 255], 4);
// PNG kodieren
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
const warnings = (m as unknown as { warnings: string[] }).warnings;
console.log(`${id}: ${m.w}x${m.h}, containers=${m.containers.length}, loot=${m.lootSpots.length}, zones=${m.zones.length}, locks=${m.locks.map(l=>l.id).join(',')}, props=${m.props.length}`);
console.log('warnings:', warnings);
