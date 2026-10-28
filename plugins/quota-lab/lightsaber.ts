// LightsaberScene — a quota bar drawn as an ignited lightsaber.
//
// The blade's LENGTH is the remaining quota. The scene is lit, not drawn:
// every pixel's light comes from its distance to the blade axis (a capsule,
// so the tip is rounded), summed from three layers and then tone-mapped like
// a camera exposure, so the core burns white and the halo saturates into the
// blade colour:
//   core  - narrow white-hot plasma column
//   glow  - the coloured body of the blade
//   halo  - wide, soft bloom that bleeds to the edges of the bar
// plus an emitter flare where the beam leaves the hilt and a bloom at the tip.
//
// Alive:
//   - fast flicker (layered oscillations + noise) and brief power dips
//   - plasma shimmer travelling along the blade, halo "breathing"
//   - ignition: the beam snaps out of the emitter with an ease-out; when the
//     quota drops it retracts smoothly; at 0% the saber is off
//   - unstable blades (Sith) crackle: the edge flares in jagged bursts and
//     spits sparks
// The hilt is pixel-art metal shaded as a cylinder (specular highlight, dark
// underside), and the blade's light spills onto it near the emitter.

export type SaberTheme = {
  glow: number[] // blade colour (linear 0..1 per channel, before exposure)
  core: number[] // core tint (near white)
  unstable: boolean // crackling, spitting blade
  flicker: number // flicker strength multiplier
}

export const JEDI_BLUE: SaberTheme = { glow: [0.16, 0.42, 1.0], core: [0.9, 0.96, 1.0], unstable: false, flicker: 1 }
export const SITH_RED: SaberTheme = { glow: [1.0, 0.07, 0.04], core: [1.0, 0.9, 0.86], unstable: true, flicker: 1.6 }


function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v
}
function hash2(x: number, y: number): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let fx = x - xi
  let fy = y - yi
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number }

export class LightsaberScene {
  readonly W: number
  readonly H: number
  private readonly th: SaberTheme
  private readonly seed: number
  private t: number
  private pct = -1
  private len = 0 // current blade length (px), animated
  private target = 0
  private ignite = 0 // ignition flash (0..1)
  private sparks: Spark[] = []
  private bg = [20, 20, 20] // the card behind the bar (set from the theme)
  private readonly axis: number // blade centre row (sub-pixel)
  private readonly hiltLen: number
  private readonly half: number // hilt half height
  private readonly colShim: Float32Array
  private readonly colFlare: Float32Array
  private readonly colJit: Float32Array
  private readonly colRR: Float32Array

  constructor(W: number, H: number, seed = 1, theme: SaberTheme = JEDI_BLUE) {
    this.W = W
    this.H = H
    this.th = theme
    this.seed = seed
    this.t = seed * 13.37
    this.axis = H / 2
    this.half = Math.max(2.5, H * 0.19)
    this.hiltLen = Math.round(clamp(W * 0.13, 30, 52))
    this.colShim = new Float32Array(W)
    this.colFlare = new Float32Array(W)
    this.colJit = new Float32Array(W)
    this.colRR = new Float32Array(W)
  }

  private get bladeStart() {
    return this.hiltLen
  }
  private get bladeMax() {
    // a full blade stops short of the bar's right edge so its rounded tip
    // and bloom finish inside the bar instead of being cut by the border
    return Math.max(0, this.W - this.hiltLen - 9)
  }

  // replacing a scene of the same bar (new pixel size): keep it lit at its
  // length and phase, no ignition
  handover(prev: unknown) {
    if (!(prev instanceof LightsaberScene)) return
    this.t = prev.t
    this.bg = prev.bg
    if (prev.pct >= 0) {
      this.pct = prev.pct
      this.target = (prev.pct / 100) * this.bladeMax
      this.len = prev.bladeMax > 0 ? (prev.len / prev.bladeMax) * this.bladeMax : this.target
    }
  }

  setBackground(rgb: number[]) {
    this.bg = rgb
  }

  setPercent(pct: number) {
    const p = clamp(pct, 0, 100)
    if (p === this.pct) return
    const fresh = this.pct < 0
    this.pct = p
    this.target = (p / 100) * this.bladeMax
    if (fresh) this.len = 0 // ignite from the emitter on first show
    if (this.target > this.len + 2) this.ignite = 1
  }

  step(dt: number) {
    dt = clamp(dt, 0, 0.2)
    this.t += dt
    // ignition snaps out fast with an ease-out; retraction is calmer
    const k = this.target > this.len ? 11 : 5
    this.len += (this.target - this.len) * Math.min(1, k * dt)
    if (Math.abs(this.target - this.len) < 0.05) this.len = this.target
    this.ignite = Math.max(0, this.ignite - dt * 1.8)
    // sparks off an unstable blade
    if (this.th.unstable && this.len > 6) {
      const n = Math.floor(dt * 26 + hash2(Math.floor(this.t * 60), 3))
      for (let i = 0; i < n && this.sparks.length < 60; i++) {
        const u = hash2(Math.floor(this.t * 997) + i, 11)
        const side = hash2(Math.floor(this.t * 991) + i, 17) < 0.5 ? -1 : 1
        this.sparks.push({
          x: this.bladeStart + u * this.len,
          y: this.axis + side * 1.2,
          vx: (hash2(i, Math.floor(this.t * 77)) - 0.5) * 30,
          vy: side * (10 + 25 * hash2(i + 5, Math.floor(this.t * 83))),
          life: 0.12 + 0.2 * u,
        })
      }
    }
    for (const s of this.sparks) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 60 * dt
      s.life -= dt
    }
    this.sparks = this.sparks.filter((s) => s.life > 0)
  }

  // global intensity: hum flicker + noise + power dips
  // A slow, gentle shimmer kept far below the frame rate: fast hum
  // oscillations aliased at the bar's frame rate into irregular pulsing, and
  // random power dips read as the blade blinking out. Neither remains.
  private flicker(): number {
    const f = this.th.flicker
    return 1 + f * 0.015 * (vnoise(this.t * 1.6, 5) - 0.5) * 2
  }

  render(buf: Uint8Array) {
    const { W, H, th, t, axis } = this
    const xb = this.bladeStart
    const L = this.len
    const on = L > 0.6
    const xe = xb + L
    const fl = this.flicker()
    const breathe = 1 + 0.05 * Math.sin(t * 2.3) + 0.03 * (vnoise(t * 3, 9) - 0.5)
    const g = th.glow
    const c = th.core
    // ---- background + hilt
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        buf[o] = this.bg[0]
        buf[o + 1] = this.bg[1]
        buf[o + 2] = this.bg[2]
        buf[o + 3] = 255
      }
    this.renderHilt(buf, on ? fl : 0)
    if (!on && this.ignite <= 0) return
    // ---- the beam: light accumulated per pixel, then exposure-tonemapped
    const exposure = 1.25
    // per-column terms (shimmer, crackle, tip taper, core jitter) are computed
    // once per column, not per pixel
    const colShim = this.colShim
    const colFlare = this.colFlare
    const colJit = this.colJit
    const colRR = this.colRR
    for (let x = 0; x < W; x++) {
      const xc = x + 0.5
      const tip = clamp((xc - (xe - 6)) / 6, 0, 1)
      colRR[x] = 1 - 0.12 * tip * tip
      let shimmer = 1 + 0.04 * Math.sin(xc * 0.33 - t * 3.2) + 0.03 * (vnoise(xc * 0.18, t * 2.2) - 0.5)
      let flare = 0
      let jit = 0
      if (th.unstable) {
        // jagged bursts a few pixels wide (not per-column stripes), and a
        // core that wavers as the unstable crystal fights the field
        const n = vnoise(xc * 0.22, t * 11) * 0.7 + vnoise(xc * 0.6, t * 23) * 0.3
        if (n > 0.58) flare = (n - 0.58) * 3.2
        shimmer += (vnoise(xc * 0.35, t * 18) - 0.5) * 0.16
        jit = (vnoise(xc * 0.45, t * 19) - 0.5) * 0.7
      }
      colShim[x] = shimmer * fl
      colFlare[x] = flare
      colJit[x] = jit
    }
    const tipOn = on ? 1 : 0
    const Rb = this.half * 0.72 // blade radius: ~0.72 of the hilt's
    for (let y = 0; y < H; y++) {
      const yc = y + 0.5
      const dy = yc - axis
      // the glow must die out INSIDE the bar: the canvas ends at the bar's
      // top and bottom, and a halo still bright there was cut off flat into
      // a visible box. Fade it to zero over the last few pixels.
      const edgeDist = Math.min(yc, H - yc)
      const ef = clamp(edgeDist / 4.5, 0, 1)
      const edgeFade = ef * ef * (3 - 2 * ef)
      for (let x = 0; x < W; x++) {
        const xc = x + 0.5
        // ...and the same at the right edge of the bar
        const rf = clamp((W - xc) / 5, 0, 1)
        const fade = edgeFade * rf * rf * (3 - 2 * rf)
        // distance to the blade capsule (rounded tip)
        const px = clamp(xc, xb, Math.max(xb, xe))
        const dx = xc - px
        const dyj = dy - colJit[x]
        const d = Math.sqrt(dx * dx + dyj * dyj)
        const rr = colRR[x]
        const flare = colFlare[x]
        const sh = colShim[x]
        // the blade is a SOLID ROD ~0.72x the hilt diameter (1" blade in a
        // ~1.4" hilt): a flat white-hot plateau that softens at the rod's edge
        // into a saturated rim, then three stacked glows of growing width
        // (the way film composites build it)
        const R = Rb * rr
        const edge = clamp((d - R * 0.5) / (R * 0.55), 0, 1) // 0 inside the plateau, 1 at the rod edge
        const core = 3.2 * (1 - edge * edge * (3 - 2 * edge))
        const rim = 1.5 * Math.exp(-(((d - R * 0.75) / (R * 0.55)) ** 2))
        const bw = (R * 1.25 + flare * 0.9)
        const body = 1.1 * Math.exp(-((d / bw) ** 2)) + rim
        const halo = (0.6 * Math.exp(-Math.max(0, d - R * 0.6) / (3.2 * breathe)) + 0.1 * Math.exp(-d / 6)) * (1 + flare * 0.5)
        let Ic = (body * rf + halo * fade) * sh
        let Iw = core * rf * sh
        // emitter flare and ignition flash
        const de = Math.hypot(xc - xb, dy)
        Ic += (0.45 + this.ignite * 1.5) * Math.exp(-de / 3.6) * fl * edgeFade
        Iw += this.ignite * 0.8 * Math.exp(-de / 2)
        // tip bloom
        if (tipOn) Ic += 0.3 * Math.exp(-Math.hypot(xc - xe, dy) / 3.5) * fl * edgeFade
        else {
          Ic *= this.ignite
          Iw *= this.ignite
        }
        const o = (y * W + x) * 4
        // additive light, tone-mapped: 1 - exp(-E)
        const r = (Ic * g[0] + Iw * c[0]) * exposure
        const gg = (Ic * g[1] + Iw * c[1]) * exposure
        const b = (Ic * g[2] + Iw * c[2]) * exposure
        buf[o] = buf[o] + (255 - buf[o]) * (1 - Math.exp(-r))
        buf[o + 1] = buf[o + 1] + (255 - buf[o + 1]) * (1 - Math.exp(-gg))
        buf[o + 2] = buf[o + 2] + (255 - buf[o + 2]) * (1 - Math.exp(-b))
      }
    }
    // ---- sparks: hot specks that cool from white to blade colour
    for (const s of this.sparks) {
      const x = Math.round(s.x)
      const y = Math.round(s.y)
      if (x < 0 || x >= W || y < 0 || y >= H) continue
      const o = (y * W + x) * 4
      const heat = clamp(s.life / 0.25, 0, 1)
      // sparks fade out before the bar's edges too (no specks on the border)
      const ed = clamp(Math.min(y + 0.5, H - y - 0.5) / 4.5, 0, 1)
      const a = ed * ed * (3 - 2 * ed)
      const sr = 255 * (heat + (1 - heat) * g[0])
      const sg = 255 * (heat * 0.9 + (1 - heat) * g[1])
      const sb = 255 * (heat * 0.8 + (1 - heat) * g[2])
      buf[o] = clamp(buf[o] + (sr - buf[o]) * a, 0, 255)
      buf[o + 1] = clamp(buf[o + 1] + (sg - buf[o + 1]) * a, 0, 255)
      buf[o + 2] = clamp(buf[o + 2] + (sb - buf[o + 2]) * a, 0, 255)
    }
  }

  // Hilt after a modern Jedi reference: ring-loop pommel with a ribbed
  // silver cap, brown leather grip, silver clamp carrying a gold control
  // plate and a black activator, a narrow neck, and a crowned silver emitter
  // with the blade's light glowing through window slots. Everything is
  // shaded as a cylinder (specular band near the top, dark underside) and
  // the blade lights the metal near the emitter.
  private renderHilt(buf: Uint8Array, fl: number) {
    const { W, H, axis, half, th, t } = this
    const Lh = this.hiltLen
    const g = th.glow
    const s = Lh / 44 // proportions defined on a 44px hilt
    const seg = (a: number) => Math.round(a * s)
    // section boundaries: ring | pommel | grip | clamp+plate | neck | emitter
    const X = [0, seg(4), seg(10), seg(27), seg(33), seg(35), Lh]
    const put = (x: number, y: number, r: number, gg: number, b: number) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return
      const o = (y * W + x) * 4
      buf[o] = clamp(r, 0, 255)
      buf[o + 1] = clamp(gg, 0, 255)
      buf[o + 2] = clamp(b, 0, 255)
    }
    // ring loop hanging off the pommel: a small steel circle outline
    {
      const cx = seg(2)
      const cy = axis
      const rad = Math.max(1.6, half * 0.62)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < X[1] + 1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
          if (Math.abs(d - rad) < 0.55) {
            const top = y + 0.5 < cy
            put(x, y, top ? 150 : 96, top ? 152 : 98, top ? 160 : 106)
          }
        }
    }
    for (let x = X[1]; x < Lh; x++) {
      let hh = half
      let base = [150, 152, 160]
      let spec = 0.7
      if (x < X[2]) {
        // pommel: rounded cap, then a ribbed silver band
        const k = x - X[1]
        hh = half - (k === 0 ? 1.1 : k === 1 ? 0.45 : 0)
        base = k < 2 ? [168, 170, 178] : [150, 152, 160]
        if (k >= 2 && (k - 2) % 2 === 1) base = [92, 94, 102] // rib grooves
      } else if (x < X[3]) {
        // brown leather wrap: warm, soft sheen, no hard specular
        base = [112, 44, 36]
        spec = 0.18
        if (x === X[2] || x === X[3] - 1) base = [80, 30, 26] // tucked ends
      } else if (x < X[4]) {
        // silver clamp with the gold control plate on top
        base = [176, 178, 188]
        if (x === X[3] || x === X[4] - 1) base = [118, 120, 130]
      } else if (x < X[5]) {
        hh = half - 0.9 // narrow neck
        base = [96, 98, 108]
      } else {
        // emitter: silver body widening into a crowned shroud
        const u = (x - X[5]) / Math.max(1, X[6] - 1 - X[5])
        hh = half + 0.3 + (u > 0.72 ? 1.3 : u * 0.5)
        base = [184, 188, 198]
        if (u > 0.72) base = [150, 154, 166] // crown prongs
      }
      for (let y = 0; y < H; y++) {
        const v = (y + 0.5 - axis) / hh // -1 top .. 1 bottom
        if (Math.abs(v) > 1) continue
        const lambert = 0.36 + 0.64 * Math.sqrt(Math.max(0, 1 - v * v)) * (v < 0 ? 1 : 0.74)
        const sp = Math.exp(-(((v + 0.45) / 0.2) ** 2)) * spec
        let r = base[0] * lambert + 255 * sp * 0.55
        let gg = base[1] * lambert + 255 * sp * 0.55
        let b = base[2] * lambert + 255 * sp * 0.58
        if (Math.abs(v) > 0.84) {
          // rim outline
          r *= 0.55
          gg *= 0.55
          b *= 0.6
        }
        // gold control plate with engraved lines, and the black activator
        if (x >= X[3] + 1 && x < X[4] - 1 && v < -0.2 && v > -0.85) {
          const line = (x - X[3]) % 2 === 0
          r = line ? 120 : 196
          gg = line ? 96 : 164
          b = line ? 50 : 92
        }
        if (x === X[4] - 1 && Math.abs(v) < 0.3) {
          r = 22
          gg = 22
          b = 26
        }
        // window slots in the emitter: the blade's light glows through
        if (x >= X[5] + 1 && x < X[6] - seg(3) && Math.abs(v) < 0.42 && (x - X[5]) % 3 !== 0) {
          const glow = (0.7 + 0.3 * fl) * (0.85 + 0.15 * Math.sin(t * 9 + x))
          r = 255 * (0.25 + 0.75 * g[0]) * glow
          gg = 255 * (0.35 + 0.65 * g[1]) * glow
          b = 255 * (0.45 + 0.55 * g[2]) * glow
        }
        // the blade lights up the metal near the emitter
        const near = Math.exp(-(Lh - x) / 5) * fl * 0.5
        r += 255 * g[0] * near * (0.6 - v * 0.4)
        gg += 255 * g[1] * near * (0.6 - v * 0.4)
        b += 255 * g[2] * near * (0.6 - v * 0.4)
        put(x, y, r, gg, b)
      }
    }
  }
}
