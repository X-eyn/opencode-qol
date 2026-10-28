import { RetroTankScene } from "./retro.ts"
const W = 330, H = 20
for (const pct of [100, 90, 62, 37, 12, 4, 0]) {
  const s = new RetroTankScene(W, H, 3); s.setBackground([20, 20, 20]); s.setPercent(pct)
  const fr: Uint8Array[] = []
  let tms = 0
  for (let k = 0; k < 300; k++) { const t = performance.now(); s.step(0.08); const b = new Uint8Array(W * H * 4); s.render(b); tms += performance.now() - t; fr.push(b) }
  // A-B-A toggles: a pixel that changes and immediately changes back
  let toggles = 0, changes = 0
  for (let k = 2; k < fr.length; k++) for (let i = 0; i < W * H * 4; i += 4) {
    const a = fr[k - 2][i] + fr[k - 2][i + 1] * 256, b = fr[k - 1][i] + fr[k - 1][i + 1] * 256, c = fr[k][i] + fr[k][i + 1] * 256
    if (b !== c) changes++
    if (a === c && a !== b) toggles++
  }
  console.log(`pct ${pct}: ${(tms / 300).toFixed(2)} ms/frame, changed px/frame ${(changes / 298 / 4).toFixed(0)}, A-B-A toggles/frame ${(toggles / 298 / 4).toFixed(1)}`)
}
// handover across a size change keeps the sea
const a = new RetroTankScene(330, 20, 1); a.setPercent(60); for (let k = 0; k < 20; k++) a.step(0.08)
const b = new RetroTankScene(340, 20, 1); b.handover(a); b.setPercent(60); b.step(0.08)
console.log("handover ok, xs", a.surf.xs, "->", b.surf.xs)
