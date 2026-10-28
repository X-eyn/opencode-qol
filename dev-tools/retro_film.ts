import { RetroTankScene } from "./retro.ts"
import { writeFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
const W = 330, H = 20, Z = 3
const frames: Uint8Array[] = []
for (const pct of (process.argv[3]||"90,40").split(",").map(Number)) {
  const s = new RetroTankScene(W, H, 2); s.setBackground([20, 20, 20]); s.setPercent(pct)
  for (let i = 0; i < 70; i++) s.step(0.08)
  for (let k = 0; k < 6; k++) { const b = new Uint8Array(W * H * 4); s.render(b); frames.push(b); for (let i = 0; i < 2; i++) s.step(0.08) }
}
const OW = W * Z + 20, OH = frames.length * (H * Z + 6) + 14
const img = new Uint8Array(OW * OH * 4); for (let i = 0; i < OW * OH; i++) img.set([18, 18, 18, 255], i * 4)
frames.forEach((f, k) => { const y0 = 8 + k * (H * Z + 6); for (let y = 0; y < H * Z; y++) for (let x = 0; x < W * Z; x++) { const s = (Math.floor(y / Z) * W + Math.floor(x / Z)) * 4, o = ((y0 + y) * OW + 10 + x) * 4; img[o] = f[s]; img[o + 1] = f[s + 1]; img[o + 2] = f[s + 2]; img[o + 3] = 255 } })
const crc32 = (b: Uint8Array) => { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const chunk = (t: string, d: Uint8Array) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), Buffer.from(d)]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]) }
const raw = Buffer.alloc((OW * 4 + 1) * OH); for (let r = 0; r < OH; r++) Buffer.from(img.buffer, r * OW * 4, OW * 4).copy(raw, r * (OW * 4 + 1) + 1)
const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(OH, 4); ih[8] = 8; ih[9] = 6
writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]))
console.log("wrote", process.argv[2])
