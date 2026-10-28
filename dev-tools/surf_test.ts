import { Surf } from "./surf.ts"
const N = 165, VH = 10
// 1) lake at rest: no waves -> nothing may move
{
  const s = new Surf(N, VH, 1); (s as any).waves.length = 0; s.setShore(120)
  for (let k = 0; k < 200; k++) s.step(0.08)
  let maxU = 0, maxE = 0
  for (let i = 0; i < N; i++) if (s.h[i] > 0.02) { maxU = Math.max(maxU, Math.abs(s.u(i))); maxE = Math.max(maxE, Math.abs(s.z[i] + s.h[i] - s.SL)) }
  console.log("lake at rest: max|u|", maxU.toFixed(5), "max|eta-SL|", maxE.toFixed(5))
}
// 2) live sea: stats per percent
for (const pct of [100, 90, 60, 30, 10, 3]) {
  const s = new Surf(N, VH, 2); const t0 = performance.now(); s.setShore(Math.round(pct / 100 * N)); const spin = performance.now() - t0
  let mass0 = 0; for (let i = 0; i < N; i++) mass0 += s.h[i]
  let maxEta = -1, minEta = 99, brkCells = 0, nan = 0, maxRun = 0, drops = 0, foamMax = 0
  const t1 = performance.now()
  for (let k = 0; k < 400; k++) {
    s.step(0.08)
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(s.h[i]) || !Number.isFinite(s.m[i])) nan++
      if (s.h[i] > 0.02) { const e = s.z[i] + s.h[i]; maxEta = Math.max(maxEta, e); minEta = Math.min(minEta, e); if (i >= s.xs && s.h[i] > 0.1) maxRun = Math.max(maxRun, i - s.xs + 1) }
      if (s.brk[i] > 0.3) brkCells++
      foamMax = Math.max(foamMax, s.foam[i])
    }
    drops = Math.max(drops, s.drops.length)
  }
  const per = (performance.now() - t1) / 400
  let mass = 0; for (let i = 0; i < N; i++) mass += s.h[i]
  console.log(`pct ${pct}: spin ${spin.toFixed(0)}ms, ${per.toFixed(2)}ms/frame, eta ${minEta.toFixed(2)}..${maxEta.toFixed(2)} (SL ${s.SL}), breaking cell-frames ${brkCells}, runup ${maxRun} cells, drops<=${drops}, foam<=${foamMax.toFixed(2)}, mass ${mass0.toFixed(0)}->${mass.toFixed(0)}, NaN ${nan}`)
}
