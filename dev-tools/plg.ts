import { Surf } from "./surf.ts"
const s = new Surf(165, 10, 2); s.setShore(90)
let made = 0, maxJet = 0, hits = 0, seen = new Set()
for (let k = 0; k < 500; k++) { s.step(0.08); for (const p of s.plunges) { if (!seen.has(p)) { seen.add(p); made++ } maxJet = Math.max(maxJet, p.jet.length / 2); if (p.hit >= 0) hits++ } }
console.log({ made, maxJet, hits, perMin: made / (500 * 0.08) * 60 })
