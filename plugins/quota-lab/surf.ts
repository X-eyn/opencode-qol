// Surf — a 1-D surf-zone wave model in virtual-pixel units (no rendering).
//
// Nothing here is keyframed. Every shape on screen is a solution of the
// equations below, driven by a random sea state:
//
//   Sea state    JONSWAP spectrum (Hasselmann et al. 1973, gamma = 3.3) split
//                into random-phase components. Their superposition beats into
//                wave groups: sets of big waves, then lulls, never repeating.
//   Hydrodynamics  Nonlinear shallow-water equations, finite volume:
//                  h_t + (hu)_x = 0
//                  (hu)_t + (hu^2 + g h^2 / 2)_x = -g h z_x - Cf u|u|
//                MUSCL/minmod reconstruction, HLL Riemann fluxes, hydrostatic
//                reconstruction for wetting/drying (Audusse et al. 2004),
//                SSP-RK2 time stepping. Bores are shocks of these equations:
//                waves steepen, break and dissipate on their own.
//   Dispersion   Peregrine (1967) Boussinesq term in non-breaking water:
//                (1 - d^2/3 d_xx) (hu)_t = RHS, a tridiagonal solve. Without it
//                every swell would steepen into a bore; with it, swell keeps its
//                rounded shape offshore and only shoals into breakers.
//   Breaking     Kennedy et al. (2000) surface-rise criterion with hysteresis:
//                starts at eta_t > 0.65 sqrt(g d), stops below 0.15 sqrt(g d),
//                or depth-limited at crest / depth > 0.8. Breaking cells switch
//                to pure shallow water (Tonelli & Petti 2009 hybrid): the
//                shock-capturing scheme dissipates the bore's energy.
//   Generation   Relaxation zone (Mayer et al. 1998): the first cells are eased
//                toward the incoming linear wave field, which both makes waves
//                and absorbs whatever the beach reflects back out.
//   Bathymetry   Dean (1977) equilibrium profile d = A s^(2/3) offshore of the
//                shoreline, a planar beach face above it.
//   Foam, air,   Scalar fields advected with the flow (upwind), sourced by
//   sediment     breaking and decaying with their own lifetimes.
//   Plunging     A breaker's lip is a free jet: launched horizontally from the
//   breakers     crest at the crest's celerity, it falls ballistically,
//                x = xc + c t, y = yc - g t^2 / 2 (Longuet-Higgins 1982), curling
//                over an air pocket until it strikes the water ahead. The impact
//                throws a splash-up at ~ sqrt(2 g H) (Peregrine 1983).
//   Wind         A strong onshore wind (storm sea): drag pulls spray landward
//                and tears spindrift off steep crests before they break.
//   Sea wall     Optional (wall = true): no beach, a flat bed and a solid
//                vertical wall at the quota line. Waves reflect into standing
//                clapotis; each slam throws a vertical jet at
//                v = sqrt(2 g rise + u^2) (rise plus stagnation head), and drops
//                hitting the wall bounce off it with restitution.
//   Spray        Ballistic drops (gravity + air drag + wind) thrown by plunging
//                lips, splash-ups, rollers, swash fronts and wall slams; they
//                land as foam or wet sand.

const G = 120 // gravity in virtual px / s^2 (deep celerity ~ 24 px/s)
const DRY = 0.015 // water thinner than this is dry
const CF = 0.02 // quadratic bed friction
const MAX_DROPS = 320
const VH_SOLID = (VH: number) => VH + 6 // wall top, above anything the sea can reach
const WIND = 14 // onshore wind speed (px/s)

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v
}
function minmod(a: number, b: number) {
  return a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b
}
function mulberry(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Drop = { x: number; y: number; vx: number; vy: number; life: number; big: boolean }
// a plunging breaker's lip, tracked with its crest
export type Plunge = { x: number; age: number; H: number; hit: number; jet: number[] }

export class Surf {
  readonly N: number
  readonly VH: number
  readonly g = G
  readonly SL: number // still-water level (px above the floor)
  readonly D0: number // offshore depth
  readonly z: Float32Array // bed height per cell
  readonly h: Float32Array // water depth
  readonly m: Float32Array // discharge h u
  readonly etaT: Float32Array // surface rise rate (last substep)
  readonly brk: Float32Array // breaking intensity 0..1
  readonly foam: Float32Array // surface foam concentration
  readonly air: Float32Array // entrained air under the roller
  readonly mud: Float32Array // suspended sand (turbidity)
  readonly wet: Float32Array // sand wetness 0..1 (drains by infiltration)
  readonly lace: Float32Array // foam stranded on the sand by the swash
  readonly drops: Drop[] = []
  readonly plunges: Plunge[] = []
  wallWet = 0 // how high the wall is wet (px above the floor)
  // up-rush sheets climbing the wall face after a slam: y(t) = y0 + v0 t - g t^2 / 2
  readonly wallJets: { t0: number; y0: number; v0: number }[] = []
  private wallPrevRise = 0
  private wallLast = -9
  private wallRising = false
  private wallInflow = 0
  readonly wall: boolean
  xs = -1 // shoreline cell (water occupies [0, xs) at still level)
  t = 0
  private readonly rnd: () => number
  private readonly waves: { a: number; w: number; p: number }[] = []
  // scratch
  private readonly h0: Float32Array
  private readonly m0: Float32Array
  private readonly dh: Float32Array
  private readonly dm: Float32Array
  private readonly fh: Float32Array // face fluxes (N + 1)
  private readonly fm: Float32Array
  private readonly sR: Float32Array // pressure correction, right face of each cell
  private readonly sLc: Float32Array // pressure correction, left face of each cell
  private readonly sc: Float32Array // centred bed-slope source
  private readonly cp: Float32Array
  private readonly disp: Uint8Array // dispersion active per cell
  private readonly onset: Float32Array

  constructor(N: number, VH: number, seed: number, wall = false) {
    this.wall = wall
    this.N = N
    this.VH = VH
    // a sea wall doubles every crest (standing clapotis) and throws sheets
    // above it: it needs a lower still level for headroom
    this.SL = VH * (wall ? 0.46 : 0.6)
    this.D0 = this.SL - 0.2
    const f = () => new Float32Array(N)
    this.z = f()
    this.h = f()
    this.m = f()
    this.etaT = f()
    this.brk = f()
    this.foam = f()
    this.air = f()
    this.mud = f()
    this.wet = f()
    this.lace = f()
    this.h0 = f()
    this.m0 = f()
    this.dh = f()
    this.dm = f()
    this.sR = f()
    this.sLc = f()
    this.sc = f()
    this.cp = f()
    this.onset = f()
    this.disp = new Uint8Array(N)
    this.fh = new Float32Array(N + 1)
    this.fm = new Float32Array(N + 1)
    this.rnd = mulberry(seed * 7919 + 13)
    this.t = this.rnd() * 1000
    this.spectrum(seed)
  }

  // JONSWAP: S(f) = a g^2 f^-5 exp(-5/4 (fp/f)^4) gamma^r, sampled at jittered
  // frequencies (no exact repeat period), amplitude from each variance share
  private spectrum(seed: number) {
    const r = mulberry(seed * 977 + 5)
    const Tp = 3.0 // long-period storm swell: high Ursell number, peaked cnoidal crests
    const Hs = this.VH * (this.wall ? 0.3 : 0.38)
    const fp = 1 / Tp
    const n = 16
    const comps: { f: number; s: number }[] = []
    for (let i = 0; i < n; i++) {
      const fr = fp * (0.7 + (1.5 * (i + r() * 0.85)) / n)
      const sig = fr <= fp ? 0.07 : 0.09
      const pm = Math.pow(fr, -5) * Math.exp(-1.25 * Math.pow(fp / fr, 4))
      const gam = Math.pow(6, // peak enhancement: a narrow spectrum beats into strong sets
       Math.exp(-((fr - fp) ** 2) / (2 * sig * sig * fp * fp)))
      comps.push({ f: fr, s: pm * gam })
    }
    const sum = comps.reduce((a, c) => a + c.s, 0)
    const var0 = (Hs / 4) ** 2 // Hs = 4 sqrt(m0)
    for (const c of comps) this.waves.push({ a: Math.sqrt(2 * var0 * (c.s / sum)), w: 2 * Math.PI * c.f, p: r() * 2 * Math.PI })
    // plus a short, choppy wind sea riding on the swell (Tp 1.1 s, broad
    // Pierson-Moskowitz spectrum): the texture that tells an ocean from a pond
    const fw = 1 / 1.1
    const wind: { f: number; s: number }[] = []
    for (let i = 0; i < 8; i++) {
      const fr = fw * (0.75 + (1.1 * (i + r() * 0.9)) / 8)
      wind.push({ f: fr, s: Math.pow(fr, -5) * Math.exp(-1.25 * Math.pow(fw / fr, 4)) })
    }
    const sw = wind.reduce((a, c) => a + c.s, 0)
    const varW = ((this.VH * 0.09) / 4) ** 2
    for (const c of wind) this.waves.push({ a: Math.sqrt(2 * varW * (c.s / sw)), w: 2 * Math.PI * c.f, p: r() * 2 * Math.PI })
  }

  // incoming linear wave field at cell x: surface and discharge. Wavenumber
  // from Peregrine's dispersion relation w^2 = g d k^2 / (1 + (kd)^2 / 3).
  private incoming(x: number, t: number, d: number, out: { e: number; q: number }) {
    let e = 0
    let q = 0
    const gd = G * d
    for (const c of this.waves) {
      const k = c.w / Math.sqrt(Math.max(1, gd - (c.w * c.w * d * d) / 3))
      const ph = Math.cos(c.w * t - k * x + c.p)
      e += c.a * ph
      q += c.a * (c.w / k) * ph // linear: u = eta * c
    }
    // a sea only a few pixels long cannot hold full-size swell
    const amp = clamp(this.xs / 70, 0.15, 1)
    out.e = e * amp
    out.q = q * amp
  }

  // ------------------------------------------------------------ bathymetry
  setShore(xs: number) {
    xs = clamp(Math.round(xs), 0, this.N)
    if (xs === this.xs) return
    const first = this.xs < 0
    const etaOld = new Float32Array(this.N)
    for (let i = 0; i < this.N; i++) etaOld[i] = this.h[i] > DRY ? this.z[i] + this.h[i] : -1
    this.xs = xs
    const { N, SL, D0, z } = this
    const L = Math.max(1, Math.min(xs, 70)) // width of the shoaling zone
    const s0 = 1.5
    const A = D0 / (Math.pow(L + s0, 2 / 3) - Math.pow(s0, 2 / 3))
    const tanB = 0.13 // beach face slope
    for (let i = 0; i < N; i++) {
      const s = xs - (i + 0.5) // distance seaward of the still shoreline
      if (this.wall) z[i] = i < xs ? SL - D0 : VH_SOLID(this.VH) // sea wall: flat bed, solid wall
      else if (xs >= N) z[i] = SL - D0 // no beach: a flat-bottomed tank with a wall
      else if (s > 0) {
        z[i] = SL - Math.min(D0, A * (Math.pow(s + s0, 2 / 3) - Math.pow(s0, 2 / 3)) + 0.12)
        // a longshore sandbar halfway out the surf zone: the big set waves
        // break on it, re-form in the trough behind and break again at the
        // shore (two lines of white water, as on a real barred beach)
        if (xs > 60) z[i] = Math.min(SL - 1.1, z[i] + 1.9 * Math.exp(-(((s - 0.5 * L) / 6) ** 2)))
      }
      else {
        // beach face rising out of the water above the run-up, then a
        // back-beach that keeps climbing gently (its dune swell never makes it
        // slope back down, so overwash drains back to the sea)
        const sp = -s
        const face = SL + 0.12 + sp * 0.16
        const top = SL + 1.9
        const back = top + Math.max(0, sp - (top - SL - 0.12) / 0.16) * 0.025 + 0.15 * Math.sin(i * 0.11 + 1.3)
        z[i] = Math.min(face < top ? face : Math.max(top, back), this.VH - 1.5)
      }
    }
    // no hollows within reach of the swash: water run up into one would pond
    // there as a lagoon (dunes may dip only well above the run-up)
    for (let i = Math.max(1, xs); i < N; i++) if (z[i] < z[i - 1] && z[i] < SL + 2.2) z[i] = z[i - 1]
    // keep the water where it is: only the bed moved
    for (let i = 0; i < N; i++) {
      const e = etaOld[i] >= 0 ? etaOld[i] : i < xs ? SL : -1
      this.h[i] = e >= 0 ? Math.max(0, e - z[i]) : 0
      if (this.h[i] <= DRY) this.m[i] = 0
    }
    if (first && xs > 0) {
      // spin up: let the swell arrive, shoal and break before the first frame
      for (let k = 0; k < 450; k++) this.substep(0.014)
    }
  }

  surface(i: number): number {
    return this.h[i] > DRY ? this.z[i] + this.h[i] : this.z[i]
  }
  u(i: number): number {
    const h = this.h[i]
    // desingularised velocity (Kurganov & Petrova 2007)
    return h > DRY ? (2 * h * this.m[i]) / (h * h + Math.max(h * h, 1e-4)) : 0
  }

  // ------------------------------------------------------------ simulation
  step(dt: number) {
    dt = clamp(dt, 0, 0.12)
    if (this.xs <= 0) {
      this.drain(dt)
      return
    }
    // CFL-limited substeps
    let smax = 1
    for (let i = 0; i < this.N; i++) if (this.h[i] > DRY) smax = Math.max(smax, Math.abs(this.u(i)) + Math.sqrt(G * this.h[i]))
    const n = Math.max(1, Math.ceil((dt * smax) / 0.45))
    for (let k = 0; k < n; k++) this.substep(dt / n)
    this.plungeStep(dt)
    this.dropsStep(dt)
  }

  private substep(dt: number) {
    const { N, h, m, h0, m0, dh, dm } = this
    this.t += dt
    h0.set(h)
    m0.set(m)
    this.markDispersion()
    // SSP-RK2 (Heun)
    this.rhs()
    for (let i = 0; i < N; i++) {
      h[i] = Math.max(0, h0[i] + dt * dh[i])
      m[i] = h[i] > DRY ? m0[i] + dt * dm[i] : 0
    }
    this.rhs()
    for (let i = 0; i < N; i++) {
      const hn = Math.max(0, 0.5 * (h0[i] + h[i] + dt * dh[i]))
      this.etaT[i] = (hn - h0[i]) / dt
      h[i] = hn
      m[i] = hn > DRY ? 0.5 * (m0[i] + m[i] + dt * dm[i]) : 0
      // implicit quadratic bed friction; thin swash sheets also lose water
      // momentum to the rough, porous sand (friction factor grows as 1/h)
      if (hn > DRY) m[i] /= 1 + (dt * CF * (1 + 0.35 / hn) * Math.abs(m[i])) / (hn * hn)
    }
    this.relax(dt)
    this.breaking(dt)
    this.fields(dt)
  }

  // Peregrine dispersion is on in deep enough, non-breaking water and two
  // cells away from any roller (it would ring against the bore otherwise)
  private markDispersion() {
    const { N, h, z, SL, brk, disp } = this
    for (let i = 0; i < N; i++) disp[i] = h[i] > 0.6 && SL - z[i] > 0.9 ? 1 : 0
    for (let i = 0; i < N; i++)
      if (brk[i] > 0.05) for (let k = Math.max(0, i - 3); k <= Math.min(N - 1, i + 2); k++) disp[k] = 0
  }

  // finite-volume right-hand side into dh, dm
  private rhs() {
    const { N, h, m, z, fh, fm, sR, sLc, sc, dh, dm } = this
    const eta = (i: number) => z[i] + h[i]
    const wetC = (i: number) => i >= 0 && i < N && h[i] > DRY
    // reconstructed face states for cell i: left (i-1/2+) and right (i+1/2-)
    // computed on the fly at each face
    const face = (i: number, side: 1 | -1, o: { h: number; u: number; z: number }) => {
      // side = +1: right face of cell i, -1: left face
      let se = 0
      let su = 0
      let sz = 0
      if (wetC(i - 1) && wetC(i) && wetC(i + 1)) {
        se = minmod(eta(i) - eta(i - 1), eta(i + 1) - eta(i))
        su = minmod(this.u(i) - this.u(i - 1), this.u(i + 1) - this.u(i))
        sz = minmod(z[i] - z[i - 1], z[i + 1] - z[i])
      }
      let hf = h[i] + 0.5 * side * (se - sz)
      if (hf < 0) {
        hf = h[i]
        se = sz
        su = 0
      }
      o.h = hf
      o.u = h[i] > DRY ? this.u(i) + 0.5 * side * su : 0
      o.z = z[i] + 0.5 * side * sz
    }
    const L = { h: 0, u: 0, z: 0 }
    const R = { h: 0, u: 0, z: 0 }
    for (let f = 0; f <= N; f++) {
      if (f === 0) {
        // seaward edge: transmissive (the relaxation zone generates/absorbs)
        face(0, -1, R)
        L.h = R.h
        L.u = R.u
        L.z = R.z
      } else face(f - 1, 1, L)
      if (f === N) {
        // landward edge: a reflecting wall
        R.h = L.h
        R.u = -L.u
        R.z = L.z
      } else if (f > 0) face(f, -1, R)
      // hydrostatic reconstruction
      const zs = Math.max(L.z, R.z)
      const hl = Math.max(0, L.h + L.z - zs)
      const hr = Math.max(0, R.h + R.z - zs)
      let Fh = 0
      let Fm = 0
      if (hl > DRY || hr > DRY) {
        const ul = hl > DRY ? L.u : 0
        const ur = hr > DRY ? R.u : 0
        const cl = Math.sqrt(G * hl)
        const cr = Math.sqrt(G * hr)
        let sl = Math.min(ul - cl, ur - cr)
        let sr = Math.max(ul + cl, ur + cr)
        if (hl <= DRY) sl = ur - 2 * cr
        if (hr <= DRY) sr = ul + 2 * cl
        const FLh = hl * ul
        const FLm = hl * ul * ul + 0.5 * G * hl * hl
        const FRh = hr * ur
        const FRm = hr * ur * ur + 0.5 * G * hr * hr
        if (sl >= 0) {
          Fh = FLh
          Fm = FLm
        } else if (sr <= 0) {
          Fh = FRh
          Fm = FRm
        } else {
          const inv = 1 / (sr - sl)
          Fh = (sr * FLh - sl * FRh + sl * sr * (hr - hl)) * inv
          Fm = (sr * FLm - sl * FRm + sl * sr * (hr * ur - hl * ul)) * inv
        }
      }
      fh[f] = Fh
      fm[f] = Fm
      // well-balanced pressure corrections for the two adjacent cells
      if (f > 0) sR[f - 1] = 0.5 * G * (L.h * L.h - hl * hl) // cell f-1, right face
      if (f < N) {
        sLc[f] = 0.5 * G * (R.h * R.h - hr * hr) // cell f, left face
        // centred bed-slope term (second order) needs both faces of cell f
        const Rf = { h: 0, u: 0, z: 0 }
        face(f, 1, Rf)
        sc[f] = -G * 0.5 * (R.h + Rf.h) * (Rf.z - R.z)
      }
    }
    for (let i = 0; i < N; i++) {
      dh[i] = -(fh[i + 1] - fh[i])
      dm[i] = -(fm[i + 1] + sR[i] - fm[i] - sLc[i]) + sc[i]
      if (h[i] <= DRY && dh[i] <= 0) {
        dh[i] = Math.max(dh[i], 0)
        dm[i] = 0
      }
    }
    this.dispersion()
  }

  // (1 - d^2/3 d_xx) dm = RHS along runs of dispersive cells (Thomas)
  private dispersion() {
    const { N, z, SL, disp, dm, cp } = this
    let i = 0
    while (i < N) {
      if (!disp[i]) {
        i++
        continue
      }
      let j = i
      while (j < N && disp[j]) j++
      const n = j - i
      if (n >= 3) {
        let pc = 0
        let pd = 0
        for (let k = 0; k < n; k++) {
          const c = i + k
          const d = SL - z[c]
          const a = (d * d) / 3
          const lo = k > 0 ? -a : 0
          const hi = k < n - 1 ? -a : 0
          const den = 1 + 2 * a - lo * pc
          pc = hi / den
          pd = (dm[c] - lo * pd) / den
          cp[k] = pc
          dm[c] = pd
        }
        for (let k = n - 2; k >= 0; k--) dm[i + k] -= cp[k] * dm[i + k + 1]
      }
      i = j
    }
  }

  // relaxation zone: ease toward the incoming wave (generates + absorbs)
  private tmpIn = { e: 0, q: 0 }
  private relax(dt: number) {
    const { h, m, z, SL, xs } = this
    const RZ = Math.min(14, Math.floor(xs / 4))
    if (RZ < 2) return
    for (let i = 0; i < RZ; i++) {
      if (h[i] <= DRY) continue
      const d = Math.max(0.5, SL - z[i])
      this.incoming(i, this.t, d, this.tmpIn)
      const w = 1 - Math.exp(-dt * 9 * Math.pow(1 - i / RZ, 3))
      const target = this.tmpIn.e
      const eta = z[i] + h[i] - SL
      h[i] = Math.max(DRY * 2, h[i] + w * (target - eta))
      m[i] += w * (this.tmpIn.q - m[i])
    }
  }

  // Kennedy et al. (2000) breaking with hysteresis; spray at onset
  private breaking(dt: number) {
    const { N, h, z, SL, brk, etaT, onset, rnd, xs } = this
    const RZ = Math.min(14, Math.floor(xs / 4))
    for (let i = 0; i < N; i++) {
      if (h[i] <= 0.08 || i < RZ + 4) {
        brk[i] *= Math.exp(-dt / 0.15)
        continue
      }
      const d = Math.max(0.3, SL - z[i])
      const c = Math.sqrt(G * d)
      const crest = z[i] + h[i] - SL
      const was = brk[i]
      const rise = etaT[i] / c
      if (rise > 0.65 || (crest > 0.8 * d && rise > 0.1)) brk[i] = Math.min(1, brk[i] + dt * 12 * Math.max(0.3, rise))
      else if (rise < 0.15) brk[i] *= Math.exp(-dt / 0.35)
      else brk[i] *= Math.exp(-dt / 1.5)
      // the plunging lip: a burst of drops thrown forward right at onset
      onset[i] = Math.max(0, onset[i] - dt)
      if (was < 0.3 && brk[i] >= 0.3 && onset[i] <= 0) {
        onset[i] = 0.5
        const u = this.u(i)
        if (crest > 0.7 && !this.plunges.some((q) => Math.abs(q.x - i) < 9)) this.plunges.push({ x: i, age: 0, H: crest + 0.6, hit: -1, jet: [] })
        const k = 2 + Math.floor(rnd() * 3)
        for (let n = 0; n < k; n++) this.drop(i + rnd(), z[i] + h[i] + 0.3, u + c * (0.35 + rnd() * 0.45), c * (0.25 + rnd() * 0.35), rnd() < 0.3)
      }
    }
  }

  private drop(x: number, y: number, vx: number, vy: number, big: boolean) {
    if (this.drops.length >= MAX_DROPS) return
    this.drops.push({ x, y, vx, vy, life: 3, big })
  }

  // foam, air and turbidity: sourced by breaking, carried by the current
  private fields(dt: number) {
    const { N, h, z, SL, brk, foam, air, mud, wet, lace, etaT, rnd } = this
    for (let i = 0; i < N; i++) {
      const b = brk[i]
      if (h[i] > DRY) {
        const d = Math.max(0.3, SL - z[i])
        const c = Math.sqrt(G * d)
        // energy dissipated in the roller ~ b * rise rate: foam and air
        const diss = b * (0.4 + Math.max(0, etaT[i]) / c)
        foam[i] = Math.min(2, foam[i] + 3.2 * diss * dt)
        air[i] = Math.min(1.5, air[i] + 4 * diss * dt)
        if (d < 3.5) mud[i] = Math.min(1, mud[i] + 0.9 * diss * (3.5 - d) * dt)
        // roller spray
        if (rnd() < 20 * b * dt) this.drop(i + rnd(), z[i] + h[i] + 0.4, this.u(i) * 0.6 + (rnd() - 0.3) * 10, 6 + rnd() * 16 * b, rnd() < 0.2)
        // spindrift: the wind tears spray off steep crests
        if (i > 0 && i < N - 1 && h[i - 1] > DRY && h[i + 1] > DRY) {
          const crestH = z[i] + h[i] - SL
          const steep = (z[i - 1] + h[i - 1] - (z[i + 1] + h[i + 1])) * 0.5
          if (crestH > 1 && steep > 0.25 && rnd() < 6 * (steep - 0.25) * dt) this.drop(i + 0.5, z[i] + h[i] + 0.3, WIND * 0.6, 3 + rnd() * 4, false)
        }
        // swash front racing up the dry sand
        if (i + 1 < N && h[i + 1] <= DRY && this.u(i) > 4) {
          foam[i] = Math.min(2, foam[i] + 4 * dt)
          if (rnd() < 1.2 * dt) this.drop(i + rnd(), z[i] + h[i] + 0.2, this.u(i) * 0.5, 5 + rnd() * 6, false)
        }
        wet[i] = 1
      } else {
        // the swash left: foam strands as a lace line, sand drains slowly
        if (foam[i] > 0.3) lace[i] = Math.max(lace[i], Math.min(0.8, foam[i] * 0.6))
        foam[i] = 0
        air[i] = 0
        mud[i] = 0
        wet[i] *= Math.exp(-dt / 4.5)
      }
      lace[i] *= Math.exp(-dt / 2.5)
    }
    // wall slam with no beach: rising water at the wall throws a jet
    const wi = this.wall ? this.xs - 1 : this.xs >= N ? N - 1 : -1
    if (wi >= 1 && h[wi] > DRY) {
      const i = wi
      const rise = z[i] + h[i] - SL
      const u = Math.max(0, this.u(i - 1)) // flow driven into the wall
      if (rise > 0.6 && etaT[i] > 1.5 && rnd() < (this.wall ? 45 : 30) * dt * Math.min(1, rise / 2)) {
        // the jet: rise plus stagnation head, v = sqrt(2 g rise + u^2)
        const v = Math.sqrt(2 * G * rise + u * u)
        this.drop(i + 0.6 - rnd() * 1.5, z[i] + h[i], -1 - rnd() * 5, v * (0.6 + rnd() * 0.6), rnd() < 0.4)
        foam[i] = Math.min(2, foam[i] + 0.3)
        foam[i - 1] = Math.min(2, foam[i - 1] + 0.2)
        this.air[i] = Math.min(1.5, this.air[i] + 0.3)
      }
    }
    if (this.wall && wi >= 1 && h[wi] > DRY) {
      // a crest arriving at the wall: flip-through. The trough ahead and the
      // crest converge on the wall and the water is squeezed into a sheet that
      // shoots up the face, much faster than the wave itself (Peregrine 2003);
      // modelled as a ballistic sheet launched at k * sqrt(2 g rise + u^2)
      const rise = z[wi] + h[wi] - SL
      this.wallInflow = Math.max(this.wallInflow * Math.exp(-dt / 0.6), Math.max(0, this.u(wi - 1)))
      // launch when the water at the wall peaks: the moment of flip-through
      if (this.wallPrevRise > rise && this.wallPrevRise > 0.7 && this.wallRising && this.t - this.wallLast > 0.7) {
        const v0 = 1.8 * Math.sqrt(2 * G * this.wallPrevRise + this.wallInflow * this.wallInflow)
        // (capped where the sheet would leave the sky for good: it then hangs too long)
        const y0 = z[wi] + h[wi]
        const v0c = Math.min(v0, Math.sqrt(2 * G * Math.max(0.5, this.VH + 3 - y0)))
        this.wallJets.push({ t0: this.t, y0, v0: v0c })
        this.wallLast = this.t
        // the impact itself bursts into spray off the top of the crest
        for (let m = 0; m < 4; m++) this.drop(wi + 0.5 - rnd(), z[wi] + h[wi] + 0.3, -2 - rnd() * 8, v0c * (0.3 + rnd() * 0.4), rnd() < 0.5)
      }
      this.wallRising = rise > this.wallPrevRise
      this.wallPrevRise = rise
    }
    // advance the sheets: they climb, stall, and shed drops as they collapse
    for (let k = this.wallJets.length - 1; k >= 0; k--) {
      const j = this.wallJets[k]
      const tt = this.t - j.t0
      const top = j.y0 + j.v0 * tt - 0.5 * G * tt * tt
      const base = wi >= 0 ? this.surface(wi) : 0
      if (top < base) {
        this.wallJets.splice(k, 1)
        continue
      }
      this.wallWet = Math.max(this.wallWet, Math.min(top, this.VH))
      // past the apex the sheet breaks up into drops thrown back seaward
      if (tt > j.v0 / G && rnd() < 70 * dt) this.drop(this.xs - 0.3 - rnd() * 1.2, top, -3 - rnd() * 9, rnd() * 4, rnd() < 0.5)
    }
    if (this.wall && this.xs > 0) {
      // the wall face stays wet up to the highest recent reach, then drains
      const e = h[this.xs - 1] > DRY ? z[this.xs - 1] + h[this.xs - 1] : 0
      this.wallWet = Math.max(e, this.wallWet - dt * 0.35)
    }
    // upwind advection of the scalars with the cell velocities
    this.advect(foam, dt)
    this.advect(air, dt)
    this.advect(mud, dt)
    for (let i = 0; i < N; i++) {
      foam[i] *= Math.exp(-dt / 4.2) // bubbles burst (storm foam is long-lived)
      air[i] *= Math.exp(-dt / 0.6) // bubbles rise out
      mud[i] *= Math.exp(-dt / 5) // sand settles
    }
  }

  private advect(f: Float32Array, dt: number) {
    const { N, h } = this
    const out = this.cp // reuse scratch (dispersion is done for this substep)
    for (let i = 0; i < N; i++) {
      const u = this.u(i)
      let v = f[i]
      if (u > 0 && i > 0 && h[i - 1] > DRY) v -= u * dt * (f[i] - f[i - 1])
      else if (u < 0 && i < N - 1 && h[i + 1] > DRY) v -= u * dt * (f[i + 1] - f[i])
      out[i] = v > 0 ? v : 0
    }
    f.set(out.subarray(0, N))
  }

  // plunging lips: follow the crest, grow the jet, splash on impact
  private plungeStep(dt: number) {
    const { N, h, rnd } = this
    for (let k = this.plunges.length - 1; k >= 0; k--) {
      const p = this.plunges[k]
      p.age += dt
      // the crest moves on: re-find the local maximum just ahead
      let xc = Math.floor(p.x)
      let best = -1
      for (let i = Math.max(0, xc - 1); i <= Math.min(N - 2, xc + 4); i++) {
        const e = this.surface(i)
        if (h[i] > DRY && e > best) {
          best = e
          xc = i
        }
      }
      p.x = Math.max(p.x, xc)
      if (best < 0 || h[xc] <= 0.2 || (p.hit >= 0 && p.age > p.hit + 0.35) || p.age > 2.5) {
        this.plunges.splice(k, 1)
        continue
      }
      // the jet: x = xc + c t, y = yc - g t^2 / 2, drawn up to the current age
      const c = Math.sqrt(G * Math.max(0.3, h[xc]))
      const yc = best + 0.35
      p.jet.length = 0
      const tMax = p.hit >= 0 ? p.hit : p.age * 0.9
      for (let tt = 0; tt <= tMax; tt += 0.012) {
        const x = xc + 0.5 + c * tt // the lip leaves at about the crest celerity
        const y = yc - 0.5 * G * tt * tt
        const i = Math.floor(x)
        if (i >= N) break
        if (y <= this.surface(i)) {
          if (p.hit < 0) {
            // impact: the splash-up, launched at ~ sqrt(2 g H)
            p.hit = tt
            const v = Math.sqrt(2 * G * Math.max(0.6, p.H))
            const n = 6 + Math.floor(rnd() * 6 + p.H * 2)
            for (let m = 0; m < n; m++) this.drop(x + rnd() - 0.5, this.surface(i) + 0.3, c * (0.2 + rnd() * 0.6), v * (0.45 + rnd() * 0.6), rnd() < 0.35)
            for (let j = Math.max(0, i - 2); j <= Math.min(N - 1, i + 2); j++) if (h[j] > DRY) {
              this.foam[j] = Math.min(2, this.foam[j] + 1)
              this.air[j] = Math.min(1.5, this.air[j] + 0.8)
            }
          }
          break
        }
        p.jet.push(x, y)
      }
    }
  }

  // ballistic spray: gravity, air drag and wind; lands as foam or wet sand
  private dropsStep(dt: number) {
    const { N, foam, wet } = this
    const drag = Math.exp(-dt * 1.2)
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k]
      d.vy -= G * 0.8 * dt
      d.vx = WIND + (d.vx - WIND) * drag // air drag toward the wind
      d.vy *= drag
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.life -= dt
      if (this.wall && d.x >= this.xs) {
        // hit the wall face: bounce back with restitution, wet the wall
        d.x = this.xs - 0.02 - (d.x - this.xs) * 0.4
        d.vx = -Math.abs(d.vx) * 0.35
        this.wallWet = Math.max(this.wallWet, Math.min(d.y, this.VH))
      }
      const i = Math.floor(d.x)
      if (i < 0 || i >= N || d.life <= 0) {
        this.drops.splice(k, 1)
        continue
      }
      if (d.vy < 0 && d.y <= this.surface(i)) {
        if (this.h[i] > DRY) foam[i] = Math.min(2, foam[i] + 0.12)
        else wet[i] = Math.max(wet[i], 0.7)
        this.drops.splice(k, 1)
      }
    }
  }

  // no sea at all: everything drains away
  private drain(dt: number) {
    for (let i = 0; i < this.N; i++) {
      this.h[i] = 0
      this.m[i] = 0
      this.wet[i] *= Math.exp(-dt / 7)
      this.lace[i] *= Math.exp(-dt / 5)
    }
    this.drops.length = 0
    this.plunges.length = 0
    this.wallJets.length = 0
  }

  // continue from another model's state (pixel-size change): resample
  adopt(prev: Surf) {
    this.t = prev.t
    const r = prev.N / this.N
    const xsNew = prev.xs < 0 ? -1 : Math.round(prev.xs / r)
    if (xsNew >= 0) {
      this.xs = xsNew - 1
      this.setShore(xsNew)
    }
    for (let i = 0; i < this.N; i++) {
      const j = Math.min(prev.N - 1, Math.floor(i * r))
      const e = prev.surface(j) * (this.VH / prev.VH)
      this.h[i] = prev.h[j] > DRY ? Math.max(0, e - this.z[i]) : 0
      this.m[i] = this.h[i] > DRY ? prev.m[j] : 0
      this.foam[i] = prev.foam[j]
      this.wet[i] = prev.wet[j]
      this.lace[i] = prev.lace[j]
      this.mud[i] = prev.mud[j]
    }
  }
}
