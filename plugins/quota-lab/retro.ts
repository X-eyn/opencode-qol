// RetroTankScene — the original quota bar's sea and beach as 8-bit pixel art,
// driven by a real surf-zone wave model (./surf).
//
// The water is not animated by hand: the swell comes from a random JONSWAP
// sea state, travels over the bed, shoals, steepens, breaks into bores, runs
// up the beach face and drains back, all as solutions of the shallow-water /
// Boussinesq equations. This file only paints that state.
//
// The canvas is a chunky virtual pixel grid (each virtual pixel = P x P real
// pixels) with a small fixed palette; gradients use 4x4 ordered (Bayer)
// dithering, the checkerboard shading of NES / Game Boy-era art. Colour is
// derived from the physics too: depth sets the water ramp, surface slope sets
// the lighting (Lambert against a low sun), thin breaking crests turn
// translucent, sun glints sit where the slope mirrors the sun into the eye,
// and foam / entrained air / stirred sand come from the model's fields.
import { Surf } from "./surf"

const P = 2 // real pixels per virtual pixel
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16))

// palette (a deliberate 8-bit ramp, not a smooth gradient)
const WATER = [
  [6, 39, 43], // abyss
  [12, 74, 78],
  [22, 120, 118],
  [40, 181, 173], // turquoise
  [104, 216, 200],
  [160, 240, 228], // mint crest
]
const MURK = [96, 132, 104] // water clouded with stirred-up sand
const FOAM = [232, 255, 251]
const SPRAY = [196, 240, 236]
const SAND_DRY = [[217, 184, 120], [196, 160, 98], [236, 210, 156]] // base, shade, sunlit
const SAND_WET = [[178, 140, 84], [146, 110, 62]]
const SAND_SUB = [[150, 206, 168], [86, 178, 160]] // sand seen through shallow water
const FISH = [[255, 150, 70], [255, 210, 120]]
const GLINT = [255, 244, 214]

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v
}
function hash2(x: number, y: number): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

// a fish leaping on a ballistic arc: x(t) = x0 + vx t, y(t) = y0 + vy t - g t^2 / 2
type Fish = { x: number; y: number; vx: number; vy: number; inAir: boolean }

export class RetroTankScene {
  readonly W: number
  readonly H: number
  private readonly VW: number
  private readonly VH: number
  private readonly seed: number
  readonly surf: Surf
  private pct = 0
  private bg = [20, 20, 20]
  private fish: Fish | null = null
  private nextFish: number
  private readonly gr: Uint8Array
  private readonly gg: Uint8Array
  private readonly gb: Uint8Array
  private readonly painted: Uint8Array // 1 where something was painted

  constructor(W: number, H: number, seed = 1) {
    this.W = W
    this.H = H
    this.VW = Math.max(8, Math.floor(W / P))
    this.VH = Math.max(4, Math.floor(H / P))
    this.seed = seed
    this.surf = new Surf(this.VW, this.VH, seed)
    this.nextFish = 5 + hash2(seed, 1) * 8
    const n = this.VW * this.VH
    this.gr = new Uint8Array(n)
    this.gg = new Uint8Array(n)
    this.gb = new Uint8Array(n)
    this.painted = new Uint8Array(n)
  }

  setBackground(rgb: number[]) {
    this.bg = rgb
  }
  setPercent(pct: number) {
    this.pct = clamp(pct, 0, 100)
    this.surf.setShore((this.pct / 100) * this.VW)
  }
  handover(prev: unknown) {
    const p = prev as RetroTankScene
    if (p && p.surf instanceof Surf) {
      this.pct = p.pct
      this.surf.adopt(p.surf)
    }
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.2)
    const s = this.surf
    s.step(dt)
    // now and then a fish leaps out of deep water
    const g = s.g * 0.8
    if (!this.fish && s.t > this.nextFish && s.xs > 30) {
      const r = hash2(Math.floor(s.t * 10), this.seed)
      const x = 8 + r * (s.xs - 26)
      const i = Math.floor(x)
      if (s.brk[i] < 0.05 && s.h[i] > 2) {
        const dir = r < 0.5 ? 1 : -1
        const apex = 2.5 + r * 2 // px above the surface
        this.fish = { x, y: s.surface(i), vx: dir * (5 + r * 4), vy: Math.sqrt(2 * g * apex), inAir: true }
      } else this.nextFish = s.t + 1
    }
    const f = this.fish
    if (f) {
      f.vy -= g * dt
      f.x += f.vx * dt
      f.y += f.vy * dt
      const i = clamp(Math.floor(f.x), 0, this.VW - 1)
      if (f.vy < 0 && f.y <= s.surface(i)) {
        // re-entry: the splash is spray drops plus a foam patch
        if (s.h[i] > 0.1) {
          s.foam[i] = Math.min(2, s.foam[i] + 0.8)
          for (let k = 0; k < 3; k++) s.drops.push({ x: f.x + (k - 1) * 0.6, y: f.y + 0.3, vx: (k - 1) * 3, vy: 7 + k * 2, life: 2, big: false })
        }
        this.fish = null
        this.nextFish = s.t + 7 + hash2(Math.floor(s.t), this.seed + 3) * 12
      }
    }
  }

  private paint(vx: number, vy: number, c: number[]) {
    // vy counts DOWN from the top of the virtual grid
    if (vx < 0 || vx >= this.VW || vy < 0 || vy >= this.VH) return
    const i = vy * this.VW + vx
    this.gr[i] = c[0]
    this.gg[i] = c[1]
    this.gb[i] = c[2]
    this.painted[i] = 1
  }
  // ordered dither between ramp entries: v in [0, ramp.length - 1]
  private dither(ramp: number[][], v: number, vx: number, vy: number): number[] {
    const lo = clamp(Math.floor(v), 0, ramp.length - 1)
    const hi = Math.min(ramp.length - 1, lo + 1)
    const f = v - lo
    return f > BAYER[vy & 3][vx & 3] ? ramp[hi] : ramp[lo]
  }
  private mix(a: number[], b: number[], f: number, vx: number, vy: number): number[] {
    return f > BAYER[vy & 3][vx & 3] ? b : a
  }

  render(buf: Uint8Array) {
    const { VW, VH } = this
    const s = this.surf
    this.painted.fill(0)
    const row = (up: number) => VH - 1 - up // pixel row for "up" pixels above the floor
    for (let x = 0; x < VW; x++) {
      const zb = s.z[x]
      const hh = s.h[x]
      const sandTop = Math.max(0, Math.round(zb)) // sand pixels [0, sandTop)
      const water = hh > 0.32
      const eta = zb + hh
      const waterTop = water ? Math.max(sandTop, Math.round(eta)) : sandTop
      // ---- sand body (also under the water)
      const dOut = x - s.xs // columns landward of the still shoreline
      let print = 0
      if (dOut >= 14 && dOut <= 40 && (dOut - 14) % 4 === 0) {
        // footprints walking up from the surf, filling in behind the walker
        const age = Math.floor(s.t * 0.15) - (dOut - 14) / 4
        if (age >= 0 && age < 12) print = 1 - age / 12
      }
      for (let k = 0; k < sandTop; k++) {
        const vy = row(k)
        const skin = k === sandTop - 1
        let col: number[]
        if (water) {
          // seen through the water: the tint depends on the water standing
          // over the bed; under a thin swash sheet it is just wet sand
          col = hh < 1.1 && x >= s.xs - 2 ? this.dither([SAND_WET[0], SAND_WET[1]], skin ? 0.2 : 0.7, x, vy) : this.dither([SAND_SUB[0], SAND_SUB[1], WATER[2], WATER[1]], clamp((hh - 1.1) / 1.4 + (skin ? 0 : 0.6), 0, 3), x, vy)
        } else {
          const w = s.wet[x]
          if (w > 0.04) col = this.dither([SAND_DRY[0], SAND_WET[0], SAND_WET[1]], w * (skin ? 2 : 1.6), x, vy)
          else col = skin ? this.dither([SAND_DRY[0], SAND_DRY[2]], 0.6, x, vy) : this.dither([SAND_DRY[0], SAND_DRY[1]], 0.35, x, vy)
          if (skin) {
            // a sheet thinner than a pixel: glossy wet skin, foam bubbles
            if (hh > 0.04) col = this.mix(SAND_WET[0], WATER[4], clamp(hh / 0.32, 0, 1), x, vy)
            if (s.lace[x] > BAYER[vy & 3][x & 3] * 1.2) col = FOAM
            if (print > 0 && w < 0.3) col = SAND_WET[0]
          }
        }
        this.paint(x, vy, col)
      }
      if (!water) continue
      // ---- water column, lit by the physics
      const xl = Math.max(0, x - 1)
      const xr = Math.min(VW - 1, x + 1)
      const slope = (s.surface(xr) - s.surface(xl)) / (xr - xl) // d eta / dx
      const still = Math.max(0.3, s.SL - zb)
      const crest = (eta - s.SL) / still // wave height relative to depth
      const brk = s.brk[x]
      const foam = s.foam[x]
      const air = s.air[x]
      const mud = s.mud[x]
      for (let k = sandTop; k < waterTop; k++) {
        const vy = row(k)
        const depth = eta - (k + 0.5) // below the surface
        // depth ramp; the seaward-facing (back) side of a wave catches the
        // low sun, the steep front face falls into shade; a crest thin
        // compared with the depth lets light through and glows
        let v = 5 - depth * 0.95 + clamp(-slope * 3, -1.2, 1.2) + clamp(crest * 1.6, -0.6, 1.4)
        v = clamp(v, 0, 5)
        let col = this.dither(WATER, v, x, vy)
        if (depth < 1) col = this.dither(WATER, Math.min(5, v + 0.7), x, vy) // lit surface skin
        // turbidity from sand stirred up by the bore
        if (mud > 0.3 && depth > 0.6) col = this.mix(col, MURK, (mud - 0.3) * 1.2, x, vy)
        // air entrained under the roller shows as pale bubbly water
        if (air > 0.1 && depth < 3) col = this.mix(col, WATER[5], air * (1 - depth / 3), x + 1, vy)
        // foam: the roller is a whole white face, residual foam a dithered lace
        const fz = foam * (depth < 1 ? 0.9 : depth < 2 ? 0.35 : 0) + (brk > 0.3 && depth < 2.2 ? brk : 0)
        if (fz > BAYER[vy & 3][x & 3]) col = FOAM
        // sun glint: the facet whose slope mirrors the sun into the eye
        if (depth < 1 && foam < 0.3 && brk < 0.1 && slope > 0.16 && slope < 0.2) col = GLINT
        this.paint(x, vy, col)
      }
    }
    // ---- plunging lips: the jet curls over a hollow (left as open air) and
    // its tip is torn white
    for (const pl of s.plunges) {
      const n = pl.jet.length / 2
      for (let k = 0; k < n; k++) {
        const x = Math.floor(pl.jet[2 * k])
        const up = Math.floor(pl.jet[2 * k + 1])
        const tip = k > n - 4
        this.paint(x, row(up), tip ? FOAM : this.dither(WATER, 4.4, x, row(up)))
        if (k < n * 0.5) this.paint(x, row(up + 1), this.dither([WATER[4], FOAM], 0.5, x, row(up + 1))) // thick near the crest
      }
    }
    // ---- spray drops
    for (const d of s.drops) {
      const x = Math.floor(d.x)
      const vy = row(Math.floor(d.y))
      this.paint(x, vy, d.big ? FOAM : SPRAY)
    }
    // ---- the fish, tail trailing its flight direction
    const f = this.fish
    if (f) {
      const x = Math.round(f.x)
      const vy = row(Math.round(f.y))
      const dir = f.vx >= 0 ? 1 : -1
      this.paint(x, vy, FISH[0])
      this.paint(x - dir, vy + (f.vy > 0 ? 1 : f.vy < -3 ? -1 : 0), FISH[1])
    }
    // ---- upscale the virtual grid to real pixels (crisp P x P blocks)
    const { W, H, bg } = this
    for (let y = 0; y < H; y++) {
      const vy = Math.min(VH - 1, Math.floor(y / P))
      for (let x = 0; x < W; x++) {
        const vx = Math.min(VW - 1, Math.floor(x / P))
        const o = (y * W + x) * 4
        const i = vy * VW + vx
        if (this.painted[i] && x < VW * P && y < VH * P) {
          buf[o] = this.gr[i]
          buf[o + 1] = this.gg[i]
          buf[o + 2] = this.gb[i]
        } else {
          buf[o] = bg[0]
          buf[o + 1] = bg[1]
          buf[o + 2] = bg[2]
        }
        buf[o + 3] = 255
      }
    }
  }
}
