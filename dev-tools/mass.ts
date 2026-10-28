import { Surf } from "./surf.ts"
for (const pct of [90, 100, 40]) {
const s = new Surf(165, 10, 2); s.setShore(Math.round(165 * pct / 100))
const out = []
for (let k = 0; k <= 3000; k++) { if (k % 500 === 0) { let m = 0; for (let i = 0; i < 165; i++) m += s.h[i]; out.push(m.toFixed(0)) } s.step(0.08) }
console.log(pct, out.join(" "))
}
