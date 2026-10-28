// Five 8-bit dithered quota scenes on a shared retro canvas.
//
// The canvas is a chunky virtual grid (each virtual pixel = 2x2 real pixels)
// drawn with small fixed palettes; gradients use 4x4 ordered (Bayer)
// dithering. Empty space is the card's own background, so every scene sits
// in the sidebar without a box. In each scene the REMAINING quota is
// something that naturally runs out:
//   PocketSnake    - the snake's body length (Game Boy LCD greens)
//   BurningFuse    - the unburnt fuse between the bomb and its spark
//   Chomper        - the dots still ahead of the arcade chomper
//   LavaFlow       - how far the molten flow reaches
//   SynthwaveSunset- the lit, rolling neon grid up to the setting sun
// Original homages, drawn from scratch - no logos, sprites or copied art.

const P = 2
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16))

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

type RGB = number[]
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number }

// ---------------------------------------------------------------- canvas
abstract class RetroCanvas {
  readonly W: number
  readonly H: number
  protected readonly VW: number
  protected readonly VH: number
  protected readonly seed: number
  protected t: number
  protected pct = 0
  protected bg: RGB = [20, 20, 20]
  private readonly cr: Uint8Array
  private readonly cg: Uint8Array
  private readonly cb: Uint8Array
  private readonly on: Uint8Array

  constructor(W: number, H: number, seed = 1) {
    this.W = W
    this.H = H
    this.VW = Math.max(16, Math.floor(W / P))
    this.VH = Math.max(6, Math.floor(H / P))
    this.seed = seed
    this.t = seed * 3.7
    const n = this.VW * this.VH
    this.cr = new Uint8Array(n)
    this.cg = new Uint8Array(n)
    this.cb = new Uint8Array(n)
    this.on = new Uint8Array(n)
  }
  setBackground(rgb: number[]) {
    this.bg = rgb
  }
  setPercent(pct: number) {
    this.pct = clamp(pct, 0, 100)
  }
  step(dt: number) {
    this.t += clamp(dt, 0, 0.2)
    this.update(clamp(dt, 0, 0.2))
  }
  protected update(_dt: number) {}
  protected abstract draw(): void

  protected bayer(vx: number, vy: number) {
    return BAYER[vy & 3][vx & 3]
  }
  // ordered dither along a palette ramp; v in [0, ramp.length - 1]
  protected dither(ramp: RGB[], v: number, vx: number, vy: number): RGB {
    const lo = clamp(Math.floor(v), 0, ramp.length - 1)
    const hi = Math.min(ramp.length - 1, lo + 1)
    return v - lo > BAYER[vy & 3][vx & 3] ? ramp[hi] : ramp[lo]
  }
  protected px(vx: number, vy: number, c: RGB) {
    vx = Math.round(vx)
    vy = Math.round(vy)
    if (vx < 0 || vx >= this.VW || vy < 0 || vy >= this.VH) return
    const i = vy * this.VW + vx
    this.cr[i] = c[0]
    this.cg[i] = c[1]
    this.cb[i] = c[2]
    this.on[i] = 1
  }
  // dithered "transparency": paint only where the Bayer threshold passes
  protected pxa(vx: number, vy: number, c: RGB, a: number) {
    if (a > this.bayer(Math.round(vx), Math.round(vy))) this.px(vx, vy, c)
  }
  // a run of quota: how many virtual columns the remaining quota covers
  protected quotaCols(from: number, to: number) {
    return Math.round((this.pct / 100) * (to - from))
  }

  render(buf: Uint8Array) {
    this.on.fill(0)
    this.draw()
    const { W, H, VW, VH, bg } = this
    for (let y = 0; y < H; y++) {
      const vy = Math.floor(y / P)
      for (let x = 0; x < W; x++) {
        const vx = Math.floor(x / P)
        const o = (y * W + x) * 4
        const i = vy * VW + vx
        if (vx < VW && vy < VH && this.on[i]) {
          buf[o] = this.cr[i]
          buf[o + 1] = this.cg[i]
          buf[o + 2] = this.cb[i]
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

// ---------------------------------------------------------------- 1. snake
// Game Boy LCD greens. The snake's body length is the remaining quota; it
// slithers with a travelling wave, its tongue flicks, a pellet blinks ahead.
const GB = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [176, 206, 44],
]
export class PocketSnake extends RetroCanvas {
  protected draw() {
    const { VW, VH, t } = this
    const mid = (VH - 1) / 2
    const len = this.quotaCols(0, VW - 10)
    const yAt = (x: number) => mid + 2.2 * Math.sin(x * 0.17 - t * 3.2) * clamp(x / 6, 0.3, 1)
    // faint LCD pixel grid behind the play field
    for (let x = 0; x < VW; x++) for (let y = 0; y < VH; y++) if ((x + y) % 4 === 0) this.pxa(x, y, GB[0], 0.35)
    if (len < 1) return
    // body: three pixels thick (light back, mid flank, dark belly) with a
    // diamond scale pattern that crawls along with the slither; tail tapers
    for (let x = 0; x <= len; x++) {
      const yi = Math.round(yAt(x))
      const k = (x + Math.floor(t * 4)) % 4
      const thick = x < 2 ? 1 : x < 5 ? 2 : 3
      this.px(x, yi - 1, k === 0 ? GB[2] : GB[3])
      if (thick >= 2) this.px(x, yi, k === 2 ? GB[3] : GB[2])
      if (thick >= 3) this.px(x, yi + 1, GB[1])
    }
    // head: a rounded wedge, a bit wider than the body, with an eye
    const hx = len + 1
    const hy = Math.round(yAt(len))
    for (let dx = 0; dx < 4; dx++)
      for (let dy = -2; dy <= 1; dy++) {
        if ((dx === 3 && (dy === -2 || dy === 1)) || (dx === 0 && dy === -2)) continue
        this.px(hx + dx, hy + dy, dy < -1 ? GB[3] : dy < 1 ? GB[2] : GB[1])
      }
    this.px(hx + 2, hy - 1, GB[0]) // eye
    this.px(hx + 2, hy - 2, GB[3])
    if (Math.sin(t * 7) > 0.3) {
      this.px(hx + 4, hy, [200, 60, 60])
      this.px(hx + 5, hy + (Math.sin(t * 14) > 0 ? -1 : 1), [200, 60, 60])
    }
    // pellet blinking just out of reach
    const pxp = Math.min(VW - 2, hx + 8)
    if (Math.sin(t * 4) > -0.4) {
      this.px(pxp, Math.round(mid), GB[3])
      this.px(pxp, Math.round(mid) + 1, GB[2])
    }
  }
}

// ---------------------------------------------------------------- 2. fuse
// A cartoon bomb with a rope fuse; the unburnt fuse is the remaining quota.
// The spark sputters at the tip, throws embers that cool from white to red,
// and puffs dithered smoke; charred ash marks the burnt length.
const EMBER = [
  [255, 255, 230],
  [255, 220, 90],
  [255, 140, 30],
  [200, 50, 20],
  [90, 20, 10],
]
export class BurningFuse extends RetroCanvas {
  private sparks: Spark[] = []
  private smoke: Spark[] = []
  private tipX() {
    return 8 + this.quotaCols(8, this.VW - 3)
  }
  private fuseY(x: number) {
    const { VH } = this
    return VH * 0.55 + 1.2 * Math.sin(x * 0.12 + 0.6) + 0.6 * Math.sin(x * 0.31)
  }
  protected update(dt: number) {
    const tip = this.tipX()
    const burning = this.pct > 0
    if (burning) {
      const n = Math.floor(dt * 40 + hash2(Math.floor(this.t * 50), 7))
      for (let i = 0; i < n && this.sparks.length < 60; i++) {
        const a = hash2(Math.floor(this.t * 997) + i, 3) * Math.PI * 2
        const v = 6 + hash2(i, Math.floor(this.t * 91)) * 14
        this.sparks.push({ x: tip, y: this.fuseY(tip), vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, life: 0, max: 0.25 + hash2(i, 5) * 0.35 })
      }
      if (hash2(Math.floor(this.t * 9), 11) > 0.8 && this.smoke.length < 14)
        this.smoke.push({ x: tip, y: this.fuseY(tip) - 1, vx: -1 + hash2(Math.floor(this.t * 7), 2) * 2, vy: -3.5, life: 0, max: 1.6 })
    }
    for (const s of this.sparks) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 22 * dt
      s.life += dt
    }
    for (const s of this.smoke) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.life += dt
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max)
    this.smoke = this.smoke.filter((s) => s.life < s.max)
  }
  protected draw() {
    const { VW, VH, t } = this
    const tip = this.tipX()
    // charred ash where the fuse has burnt
    for (let x = tip + 1; x < VW - 2; x++) if (hash2(x, 9) > 0.6) this.px(x, Math.round(this.fuseY(x)) + 1, [60, 58, 56])
    // the rope: twisted pattern
    for (let x = 6; x <= tip; x++) {
      const y = Math.round(this.fuseY(x))
      this.px(x, y, (x + Math.floor(x / 2)) % 3 === 0 ? [150, 110, 60] : [205, 165, 100])
    }
    // the bomb
    const bx = 3
    const by = VH * 0.55
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy)
        if (d > 3.3) continue
        const lit = clamp(1 - (dx + dy + 4) / 7, 0, 1)
        this.px(bx + dx, by + dy, this.dither([[16, 16, 22], [44, 46, 60], [110, 116, 140]], lit * 1.6, bx + dx, Math.round(by + dy)))
      }
    this.px(bx - 1, by - 2, [210, 215, 230]) // shine
    this.px(bx + 2, by - 3, [120, 120, 130]) // cap
    this.px(bx + 3, by - 3, [120, 120, 130])
    if (this.pct <= 0) return
    // smoke puffs, thinning as they rise
    for (const s of this.smoke) {
      const a = 1 - s.life / s.max
      for (const [dx, dy] of [[0, 0], [1, 0], [0, -1]]) this.pxa(s.x + dx, s.y + dy, [120, 120, 128], a * 0.8)
    }
    // the spark: flickering core
    const ty = Math.round(this.fuseY(tip))
    const fl = 0.6 + 0.4 * Math.sin(t * 31) * Math.sin(t * 17)
    this.px(tip, ty, EMBER[0])
    this.px(tip + 1, ty, fl > 0.5 ? EMBER[1] : EMBER[2])
    this.px(tip, ty - 1, fl > 0.3 ? EMBER[1] : EMBER[2])
    this.px(tip - 1, ty, EMBER[2])
    // embers cooling from white to deep red
    for (const s of this.sparks) this.px(s.x, s.y, EMBER[Math.min(4, Math.floor((s.life / s.max) * 5))])
  }
}

// ---------------------------------------------------------------- 3. chomper
// Arcade-maze homage. Dots ahead are the remaining quota; the chomper has
// eaten the rest, mouth flapping. A power pellet blinks at the end and a
// small ghost drifts through the eaten part.
const MAZE = [33, 33, 222]
const YEL = [[200, 170, 0], [255, 220, 0], [255, 245, 140]]
const GHOSTS = [[255, 60, 60], [255, 150, 210], [60, 220, 255], [255, 170, 60]]
export class Chomper extends RetroCanvas {
  protected draw() {
    const { VW, VH, t } = this
    const mid = Math.round((VH - 1) / 2)
    // maze walls: top and bottom double lines
    for (let x = 0; x < VW; x++) {
      this.px(x, 0, MAZE)
      this.px(x, VH - 1, MAZE)
      if (x % 2 === 0) {
        this.pxa(x, 1, [20, 20, 120], 0.5)
        this.pxa(x, VH - 2, [20, 20, 120], 0.5)
      }
    }
    const used = 1 - this.pct / 100
    const cx = Math.round(4 + used * (VW - 12))
    // dots still ahead, and the power pellet
    for (let x = cx + 5; x < VW - 4; x += 4) this.px(x, mid, [255, 200, 170])
    if (this.pct > 0 && Math.sin(t * 5) > -0.2) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, -1], [1, -1]]) this.px(VW - 3 + dx, mid + dy, [255, 200, 170])
    // the chomper: dithered disc with a flapping mouth facing right
    const open = (Math.sin(t * 12) * 0.5 + 0.5) * 0.75
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) > 3.4) continue
        const ang = Math.abs(Math.atan2(dy, dx))
        if (dx > 0 && ang < open) continue
        this.px(cx + dx, mid + dy, this.dither(YEL, clamp(1.6 - (dx + dy) * 0.25, 0, 2), cx + dx, mid + dy))
      }
    this.px(cx, mid - 2, [20, 20, 20]) // eye
    // a ghost drifting in the eaten corridor
    if (cx > 14) {
      const gx = Math.round(3 + (cx - 12) * (0.5 + 0.5 * Math.sin(t * 0.7)))
      const col = GHOSTS[Math.floor(t / 6) % GHOSTS.length]
      for (let dy = -3; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (dy === -3 && Math.abs(dx) === 2) continue
          if (dy === 2 && (dx + Math.floor(t * 6)) % 2 !== 0) continue // wavy skirt
          this.px(gx + dx, mid + dy, col)
        }
      const look = Math.cos(t * 0.7) > 0 ? 1 : 0
      this.px(gx - 1 + look, mid - 1, [255, 255, 255])
      this.px(gx + 1 + look, mid - 1, [255, 255, 255])
      this.px(gx - 1 + look + (look ? 0 : 0), mid - 1, [255, 255, 255])
      this.px(gx + look, mid - 1, [40, 60, 200])
    }
  }
}

// ---------------------------------------------------------------- 4. lava
// Molten lava reaches as far as the remaining quota. Cooling crust plates
// drift on it with glowing cracks between, bubbles rise and pop, spitting
// embers; past the flow lies cooled black basalt.
const LAVA = [
  [70, 8, 6],
  [150, 20, 8],
  [220, 60, 10],
  [255, 140, 20],
  [255, 220, 90],
]
export class LavaFlow extends RetroCanvas {
  private embers: Spark[] = []
  private bubbles: { x: number; y: number; r: number }[] = []
  private reach() {
    return this.quotaCols(0, this.VW - 1)
  }
  private surf(x: number) {
    return this.VH * 0.5 + 0.9 * Math.sin(x * 0.21 + this.t * 1.1) + 0.5 * Math.sin(x * 0.53 - this.t * 1.7)
  }
  protected update(dt: number) {
    const reach = this.reach()
    if (reach > 4 && hash2(Math.floor(this.t * 6), 3) > 0.7 && this.bubbles.length < 6)
      this.bubbles.push({ x: 2 + hash2(Math.floor(this.t * 13), 5) * (reach - 4), y: this.VH - 1, r: 1 })
    for (const b of this.bubbles) b.y -= dt * 3.5
    const popped = this.bubbles.filter((b) => b.y <= this.surf(b.x) + 0.2)
    for (const b of popped)
      for (let k = 0; k < 4; k++)
        this.embers.push({ x: b.x, y: this.surf(b.x) - 1, vx: (hash2(k, Math.floor(this.t * 40)) - 0.5) * 10, vy: -6 - hash2(k + 3, Math.floor(this.t * 40)) * 8, life: 0, max: 0.6 + hash2(k, 9) * 0.5 })
    this.bubbles = this.bubbles.filter((b) => b.y > this.surf(b.x) + 0.2)
    for (const e of this.embers) {
      e.x += e.vx * dt
      e.y += e.vy * dt
      e.vy += 9 * dt
      e.life += dt
    }
    this.embers = this.embers.filter((e) => e.life < e.max)
  }
  protected draw() {
    const { VW, VH, t } = this
    const reach = this.reach()
    for (let x = 0; x < VW; x++) {
      if (x <= reach) {
        const s = this.surf(x)
        const front = clamp((reach - x) / 3, 0, 1) // the flow front cools
        for (let y = Math.ceil(VH - 1 - s); y < VH; y++) {
          const depth = y - (VH - 1 - s)
          let v = clamp(3.6 - depth * 0.35, 0.5, 4) * (0.55 + 0.45 * front)
          // drifting crust plates with glowing cracks between them
          const n = vnoise((x - t * 1.2) * 0.35, y * 0.6)
          if (n > 0.62 && depth > 0.5) v = n > 0.66 ? 0.2 : 2.6
          this.px(x, y, this.dither(LAVA, v, x, y))
        }
        // heat haze glowing above the surface
        this.pxa(x, Math.round(VH - 2 - s), LAVA[1], 0.25 * front)
      } else {
        // cooled basalt beyond the flow
        const h = 2 + 1.2 * Math.sin(x * 0.19 + 1) + 0.6 * Math.sin(x * 0.5)
        for (let y = Math.ceil(VH - h); y < VH; y++) this.px(x, y, this.dither([[22, 20, 24], [44, 40, 44], [70, 64, 66]], (y === Math.ceil(VH - h) ? 1.6 : 0.6) + (hash2(x, y) - 0.5) * 0.6, x, y))
        if (x - reach < 3 && hash2(x, Math.floor(t * 2)) > 0.7) this.px(x, VH - 1, LAVA[1]) // last glow in the cracks
      }
    }
    for (const b of this.bubbles) this.px(b.x, b.y, LAVA[4])
    for (const e of this.embers) this.px(e.x, e.y, LAVA[Math.max(1, 4 - Math.floor((e.life / e.max) * 4))])
  }
}

// ---------------------------------------------------------------- 5. synthwave
// An 80s horizon. The lit part of the scene is the remaining quota: a
// striped sunset sun sits at the boundary over a neon grid rolling toward
// you; beyond it the grid is powered down. A pixel car's taillights glow on
// the road under the sun.
const SKY = [
  [26, 8, 46],
  [70, 16, 86],
  [150, 30, 120],
  [230, 80, 120],
  [255, 150, 90],
]
const SUN = [[255, 90, 120], [255, 150, 80], [255, 220, 110]]
export class SynthwaveSunset extends RetroCanvas {
  protected draw() {
    const { VW, VH, t } = this
    const hz = Math.round(VH * 0.5) // horizon row
    const lit = this.quotaCols(0, VW - 1)
    const sunX = clamp(lit - 6, 6, VW - 7)
    const sky = [SKY[0], SKY[2], SKY[3]]
    // sky: a short ramp dithered into smooth bands, only over the lit part
    for (let x = 0; x <= lit; x++) for (let y = 0; y < hz; y++) this.px(x, y, this.dither(sky, (y / Math.max(1, hz - 1)) * 2, x, y))
    // ground: dark floor, bright horizon line
    for (let x = 0; x < VW; x++) {
      const on = x <= lit
      this.px(x, hz, on ? [255, 120, 220] : [52, 28, 60])
      if (on) for (let y = hz + 1; y < VH; y++) this.pxa(x, y, [40, 8, 50], 0.7)
    }
    // vertical lines fanning out from the vanishing point under the sun
    for (let k = -20; k <= 20; k++) {
      for (let y = hz + 1; y < VH; y++) {
        const depth = (y - hz) / (VH - 1 - hz)
        const x = Math.round(sunX + k * 9 * depth)
        if (x < 0 || x >= VW) continue
        this.px(x, y, x <= lit ? [200, 30, 180] : [46, 24, 54])
      }
    }
    // ONE horizontal line at a time rolling toward the viewer, accelerating
    const u = (t * 0.7) % 1
    const ly = hz + 1 + Math.floor(u * u * (VH - 1 - hz))
    for (let x = 0; x <= lit; x++) this.px(x, ly, [230, 60, 210])
    if (lit < 6) return
    // the striped sun sitting on the horizon at the boundary
    const r = hz - 0.2
    for (let dy = -Math.ceil(r); dy <= -1; dy++)
      for (let dx = -Math.ceil(r) - 1; dx <= Math.ceil(r) + 1; dx++) {
        const y = hz + dy
        if (Math.hypot(dx * 0.85, dy + 0.5) > r || y < 0) continue
        if (dy >= -2 && (y + Math.floor(t * 1.5)) % 2 === 0) continue // retro stripes
        this.px(sunX + dx, y, this.dither(SUN, clamp(2.2 + dy * 0.5, 0, 2), sunX + dx, y))
      }
    // taillights of a car on the road under the sun
    const cy = VH - 2
    const blink = Math.sin(t * 2) > -0.8
    this.px(sunX - 1, cy, [255, 40, 60])
    this.px(sunX + 1, cy, blink ? [255, 40, 60] : [160, 20, 40])
    this.px(sunX, cy, [30, 10, 40])
    this.px(sunX, cy - 1, [60, 30, 80])
  }
}
