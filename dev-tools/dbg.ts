import { RetroTankScene } from "./retro.ts"
for (const pct of [55]) {
  const s = new RetroTankScene(330, 20, 2); s.setPercent(pct)
  for (let i = 0; i < 70; i++) s.step(0.08)
  const f = s.surf, a = 84, b = 125
  const r = []
  for (let i = a; i < b; i++) r.push(`${i}: z${f.z[i].toFixed(2)} h${f.h[i].toFixed(2)} u${f.u(i).toFixed(1)}`)
  console.log(pct, "xs", f.xs, "\n" + r.join("\n"))
}
