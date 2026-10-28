// ../plugins/quota-lab/pixelsea.ts
var G = 140;
var SUB_DT = 0.008;
var CF = 0.03;
var PG = 190;
var MAX_PARTICLES = 480;
var HS = 5.6;
var TP = 2.4;
var BRK_START = 0.36;
var BRK_STOP = 0.12;
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var MIAMI_DUSK = {
  skyTop: [17, 14, 28],
  skyLow: [52, 32, 60],
  skyGlow: [118, 66, 74],
  waterTop: [86, 224, 210],
  waterDeep: [8, 58, 82],
  shallow: [70, 214, 204],
  crest: [214, 255, 248],
  foam: [244, 255, 252],
  glitter: [255, 236, 214],
  sandDry: [243, 229, 199],
  sandWet: [204, 182, 142],
  shellA: [255, 246, 238],
  shellB: [238, 186, 176],
  spray: [232, 252, 250],
  trunk: [139, 104, 70],
  trunkRing: [104, 76, 50],
  frondBase: [36, 112, 58],
  frondTip: [112, 196, 92],
  coconut: [92, 62, 34],
  bush: [44, 108, 60],
  bushLight: [76, 146, 76],
  grass: [120, 160, 84],
  grassTip: [172, 196, 112],
  towerColors: [
    [246, 150, 186],
    [104, 214, 210],
    [250, 214, 102]
  ],
  towerLeg: [236, 232, 226],
  gull: [238, 238, 244],
  props: true,
  shells: true,
  glitterOn: true,
  moon: false,
  stars: 0.006
};

class PixelSea {
  W;
  H;
  seed;
  th;
  rnd;
  SL;
  prof;
  sandH;
  bed;
  h;
  q;
  qt;
  tri;
  etaPrev;
  brk;
  foam;
  mud;
  lab;
  xi;
  sheen;
  foamLine;
  swX0 = -1;
  swX0i = 1e9;
  swSlope = 0.05;
  swEvents = [];
  swLast = -99;
  swPrevEta = 0;
  swH;
  swCov;
  swFoam;
  swTip;
  swUp;
  swBurst;
  tmp;
  surfR;
  srcR;
  ripR;
  visR;
  fillR;
  surfPrev;
  wet;
  parts = [];
  waves = [];
  t = 0;
  xs = -1;
  palms = [];
  bushes = [];
  tufts = [];
  tower = null;
  gull = { x: -99, y: 3, v: 12, next: 4 };
  debugOverlays = true;
  constructor(W, H, seed = 1, theme = MIAMI_DUSK) {
    this.th = theme;
    this.W = W;
    this.H = H;
    this.seed = seed;
    this.rnd = mulberry32(seed * 7919 + 17);
    this.SL = H * 0.42;
    this.prof = new Float32Array(W);
    this.sandH = new Int16Array(W);
    this.bed = new Float32Array(W);
    this.h = new Float32Array(W);
    this.q = new Float32Array(W + 1);
    this.qt = new Float32Array(W + 1);
    this.tri = new Float32Array(W + 1);
    this.etaPrev = new Float32Array(W);
    this.brk = new Float32Array(W);
    this.foam = new Float32Array(W);
    this.mud = new Float32Array(W);
    this.lab = new Float32Array(W);
    this.xi = new Float32Array(W);
    this.sheen = new Float32Array(W);
    this.foamLine = new Float32Array(W);
    this.swH = new Float32Array(W);
    this.swCov = new Float32Array(W);
    this.swFoam = new Float32Array(W);
    this.swTip = new Float32Array(W);
    this.swUp = new Uint8Array(W);
    this.swBurst = new Float32Array(W);
    this.tmp = new Float32Array(W);
    this.surfR = new Float32Array(W);
    this.srcR = new Int32Array(W);
    this.ripR = new Float32Array(W);
    this.visR = new Uint8Array(W);
    this.fillR = new Uint8Array(W);
    this.surfPrev = new Float32Array(W).fill(-1);
    this.wet = new Float32Array(W * H);
    this.t = this.rnd() * 100;
    this.buildSpectrum();
  }
  buildSpectrum() {
    const r = mulberry32(this.seed * 977 + 5);
    const fp = 1 / TP;
    const n = 14;
    const comps = [];
    for (let i = 0;i < n; i++) {
      const f = fp * (0.72 + 1.6 * (i + r() * 0.8) / n);
      const sig = f <= fp ? 0.07 : 0.09;
      const pm = Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4));
      const gamma = Math.pow(3.3, Math.exp(-((f - fp) * (f - fp)) / (2 * sig * sig * fp * fp)));
      comps.push({ f, s: pm * gamma });
    }
    let sum = 0;
    for (const c of comps)
      sum += c.s;
    const sigma = HS / 4;
    for (const c of comps) {
      this.waves.push({ a: Math.sqrt(2 * sigma * sigma * (c.s / sum)), w: 2 * Math.PI * c.f, p: r() * 2 * Math.PI });
    }
  }
  incoming(t) {
    let e = 0;
    for (const c of this.waves)
      e += c.a * Math.cos(c.w * t + c.p);
    return e;
  }
  setPercent(pct) {
    const xs = Math.round(clamp(pct, 0, 100) / 100 * this.W);
    if (xs === this.xs)
      return;
    this.xs = xs;
    this.build();
  }
  build() {
    const { W, H, SL, xs, seed } = this;
    const L = Math.max(4, Math.min(48, xs * 0.32));
    const shore = SL - 0.6;
    const beachTop = Math.min(H - 3, SL + 2.5);
    for (let x = 0;x < W; x++) {
      let p;
      if (x < xs - L)
        p = -2.5;
      else if (x < xs) {
        const u = (x - (xs - L)) / L;
        const bar = L > 24 ? 1.1 * Math.exp(-((u - 0.55) * (u - 0.55)) / 0.012) : 0;
        p = -2.5 + Math.pow(u, 1.6) * (shore + 2.5) + bar;
      } else {
        const u = W - 1 - xs > 0 ? (x - xs) / (W - 1 - xs) : 1;
        const dune = 1.1 * Math.sin(x * 0.045 + seed) + 0.6 * Math.sin(x * 0.11 + seed * 2.3) + 0.3 * Math.sin(x * 0.27 + seed * 4.1);
        p = shore + (beachTop - shore) * Math.sqrt(u) + dune * Math.min(1, (x - xs) / 12);
        if (x - xs > 3)
          p = Math.max(p, SL + 0.6);
      }
      this.prof[x] = clamp(p, -3, H - 3);
      this.sandH[x] = Math.max(0, Math.round(this.prof[x]));
    }
    for (let pass = 0;pass < 3; pass++) {
      for (let x = 1;x < W - 2; x++) {
        const l = this.sandH[x - 1];
        if (this.sandH[x] < Math.min(l, this.sandH[x + 1]))
          this.sandH[x] = Math.min(l, this.sandH[x + 1]);
        else if (this.sandH[x] < l && this.sandH[x + 1] < this.sandH[x + 2] && Math.max(this.sandH[x], this.sandH[x + 1]) < Math.min(l, this.sandH[x + 2])) {
          const fill = Math.min(l, this.sandH[x + 2]);
          this.sandH[x] = fill;
          this.sandH[x + 1] = fill;
        }
      }
    }
    for (let x = 0;x < W; x++)
      this.prof[x] = Math.max(this.prof[x], this.sandH[x] - 0.49);
    for (let x = 0;x < W; x++)
      this.updateBed(x);
    let open = xs > 0;
    for (let x = 0;x < W; x++) {
      if (open && this.bed[x] >= SL)
        open = false;
      this.h[x] = open ? Math.max(0, SL - this.bed[x]) : 0;
      this.etaPrev[x] = this.bed[x] + this.h[x];
      this.lab[x] = x;
    }
    this.q.fill(0);
    this.brk.fill(0);
    this.foam.fill(0);
    this.mud.fill(0);
    this.xi.fill(0);
    this.sheen.fill(0);
    this.foamLine.fill(0);
    this.parts.length = 0;
    for (let x = 0;x < W; x++) {
      for (let j = 0;j < H; j++)
        this.wet[j * W + x] = j + 0.5 < SL ? 1 : 0;
    }
    this.setupSwash();
    this.decorate();
  }
  setupSwash() {
    const { W, SL, prof } = this;
    this.swEvents = [];
    this.swH.fill(0);
    this.swCov.fill(0);
    this.swFoam.fill(0);
    this.swBurst.fill(0);
    this.swX0 = -1;
    this.swX0i = 1e9;
    if (this.xs <= 2 || this.xs >= W - 3)
      return;
    let x0 = -1;
    for (let x = Math.max(1, this.xs - 4);x < W - 1; x++) {
      if (prof[x] >= SL - 0.05) {
        const a = prof[x - 1];
        const b = prof[x];
        x0 = x - 1 + clamp((SL - 0.05 - a) / Math.max(0.001, b - a), 0, 1);
        break;
      }
    }
    if (x0 < 0)
      return;
    this.swX0 = x0;
    this.swX0i = Math.ceil(x0);
    const span = Math.max(4, Math.min(22, W - 2 - this.swX0i));
    this.swSlope = clamp((prof[Math.min(W - 1, this.swX0i + span)] - prof[this.swX0i]) / span, 0.03, 0.3);
  }
  decorate() {
    const T = this.th;
    const { W, xs } = this;
    const r = mulberry32(this.seed * 131 + xs * 7 + 3);
    const beachW = W - xs;
    this.palms = [];
    this.bushes = [];
    this.tufts = [];
    this.tower = null;
    if (!T.props || beachW < 3)
      return;
    if (beachW >= 70) {
      this.tower = { x: Math.round(xs + beachW * (0.42 + r() * 0.16)), color: T.towerColors[Math.floor(r() * T.towerColors.length)] };
    }
    const towerC = this.tower ? this.tower.x + 1.5 : -999;
    const clearOfTower = (x, gap) => Math.abs(x - towerC) >= gap;
    const count = beachW < 20 ? 1 : Math.min(5, Math.max(1, Math.floor(beachW / 38)));
    for (let i = 0;i < count; i++) {
      let x;
      if (beachW < 20)
        x = xs + Math.max(1, Math.round(beachW * 0.55));
      else
        x = Math.round(xs + 7 + (beachW - 14) * (i + 0.2 + r() * 0.6) / count);
      for (let tries = 0;tries < 40; tries++) {
        const prev = this.palms[this.palms.length - 1];
        if (clearOfTower(x, 13) && (!prev || x - prev.x >= 12))
          break;
        x++;
      }
      if (x >= W - 1 || !clearOfTower(x, 13))
        continue;
      const size = 0.85 + r() * 0.3;
      this.palms.push({
        x,
        h: 0.75 + r() * 0.25,
        lean: -(1.2 + r() * 2.2) * (beachW < 20 ? 1.3 : 1 - (x - xs) / (beachW * 1.4)),
        size,
        ph: r() * 6.28
      });
    }
    const clearOfPalms = (x, gap) => this.palms.every((p) => Math.abs(x - p.x) >= gap);
    for (let x = xs + 10;x < W - 4; x += 9 + Math.floor(r() * 16)) {
      if (!clearOfTower(x, 9))
        continue;
      const back = (x - xs) / beachW > 0.4;
      if (back && r() < 0.6 && clearOfPalms(x + 3, 6))
        this.bushes.push({ x, w: 5 + Math.floor(r() * 3), ph: r() * 6.28 });
      else if (clearOfPalms(x, 3))
        this.tufts.push({ x, h: 1 + Math.floor(r() * 3), ph: r() * 6.28 });
    }
  }
  groundRow(x) {
    const xi = clamp(Math.round(x), 0, this.W - 1);
    return this.H - Math.max(1, this.sandH[xi]);
  }
  updateBed(x) {
    this.bed[x] = this.sandH[x] > 0 ? this.sandH[x] : Math.min(0, this.prof[x]);
  }
  stillDepth(i) {
    return Math.max(0, this.SL - this.bed[i]);
  }
  step(dt) {
    dt = clamp(dt, 0, 0.12);
    if (this.xs < 0)
      return;
    const n = Math.max(1, Math.ceil(dt / SUB_DT));
    const sdt = dt / n;
    for (let k = 0;k < n; k++) {
      this.t += sdt;
      this.hydro(sdt);
    }
    this.breaking(dt);
    this.stepSwash(dt);
    this.stepParticles(dt);
    this.stepFields(dt);
    this.stepSand(dt);
    this.stepWet(dt);
    const g = this.gull;
    if (g.x > -50) {
      g.x += g.v * dt;
      if (g.x > this.W + 6) {
        g.x = -99;
        g.next = this.t + 8 + this.rnd() * 20;
      }
    } else if (this.th.props && this.t > g.next) {
      g.x = -4;
      g.y = 1 + Math.floor(this.rnd() * 4);
      g.v = 9 + this.rnd() * 9;
    }
  }
  hydro(dt) {
    const { W, h, q, qt, tri, bed, SL, brk } = this;
    const wet = (i) => h[i] > 0.02;
    const uf = (i, hf) => hf > 0.05 ? q[i] / hf : 0;
    for (let i = 1;i < W; i++) {
      const bL = bed[i - 1];
      const bR = bed[i];
      const hL = h[i - 1];
      const hR = h[i];
      const etaL = bL + hL;
      const etaR = bR + hR;
      const hf = Math.max(0, Math.max(etaL, etaR) - Math.max(bL, bR));
      if (hf < 0.01 || !wet(i - 1) && !wet(i)) {
        qt[i] = 0;
        tri[i] = -1;
        continue;
      }
      tri[i] = hf;
      let r = -G * hf * (etaR - etaL);
      const u0 = uf(i, hf);
      if (u0 >= 0) {
        const hfm = i > 1 ? Math.max(0.05, 0.5 * (h[i - 2] + h[i - 1])) : hf;
        r -= u0 * q[i] - uf(i - 1, hfm) * q[i - 1];
      } else if (i < W - 1) {
        const hfp = Math.max(0.05, 0.5 * (h[i] + h[i + 1]));
        r -= uf(i + 1, hfp) * q[i + 1] - u0 * q[i];
      }
      const b = Math.max(brk[i - 1], brk[i]);
      if (b > 0) {
        const nu = Math.min(0.42 / dt, 1.4 * b * Math.min(hf, 4) * Math.sqrt(G * Math.max(hf, 0.1)) * 0.35);
        r += nu * (q[i - 1] - 2 * q[i] + (i < W ? q[i + 1] : 0));
      }
      qt[i] = r;
    }
    let i = 1;
    while (i < W) {
      if (tri[i] < 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < W && tri[j] >= 0)
        j++;
      const n = j - i;
      if (n >= 3) {
        const cp = this.tmp;
        let prevC = 0;
        let prevD = 0;
        for (let k = 0;k < n; k++) {
          const f = i + k;
          const d = Math.max(0, SL - Math.max(bed[f - 1], bed[f]));
          const on = d > 1.2 && brk[f - 1] < 0.05 && brk[f] < 0.05;
          const a = on ? d * d / 3 : 0;
          const lo = k > 0 ? -a : 0;
          const hi = k < n - 1 ? -a : 0;
          const di = 1 + 2 * a;
          const denom = di - lo * prevC;
          const c = hi / denom;
          const dd = (qt[f] - lo * prevD) / denom;
          cp[k] = c;
          qt[f] = dd;
          prevC = c;
          prevD = dd;
        }
        for (let k = n - 2;k >= 0; k--)
          qt[i + k] -= cp[k] * qt[i + k + 1];
      }
      i = j;
    }
    for (let f = 1;f < W; f++) {
      const hf = tri[f];
      if (hf < 0) {
        q[f] = 0;
        continue;
      }
      let qi = q[f] + qt[f] * dt;
      qi /= 1 + CF * dt * Math.abs(qi) / (hf * hf);
      const donor = qi > 0 ? h[f - 1] : h[f];
      const maxq = donor * 0.24 / dt;
      if (qi > maxq)
        qi = maxq;
      else if (qi < -maxq)
        qi = -maxq;
      q[f] = qi;
    }
    if (this.xs > 0 && h[0] > 0.05) {
      const d0 = this.stillDepth(0);
      const c0 = Math.sqrt(G * Math.max(d0, 0.5));
      const etaIn = this.incoming(this.t) * clamp(this.xs / 80, 0.2, 1);
      const eta0 = bed[0] + h[0] - SL;
      q[0] = c0 * (2 * etaIn - eta0);
    } else
      q[0] = 0;
    q[W] = 0;
    let prev = q[0];
    for (let f = 1;f < W; f++) {
      const cur = q[f];
      const k = f < 50 && this.xs > 60 ? 0.05 + 0.2 * (1 - f / 50) : 0.05;
      if (tri[f] >= 0 && h[f - 1] > 0.05 && h[f] > 0.05)
        q[f] = cur + k * (prev - 2 * cur + q[f + 1]);
      prev = cur;
    }
    for (let c = 0;c < W; c++) {
      const v = h[c] - (q[c + 1] - q[c]) * dt;
      h[c] = v > 0 ? v : 0;
    }
    if (this.xs > 16) {
      const d0 = this.stillDepth(0);
      const c0 = Math.sqrt(G * Math.max(d0, 0.5));
      const kAmp = clamp(this.xs / 80, 0.2, 1);
      const RZ = 14;
      for (let c = 0;c < RZ; c++) {
        if (h[c] < 0.05)
          continue;
        const w = Math.pow(1 - c / RZ, 2) * 0.06;
        const target = this.incoming(this.t - c / c0) * kAmp;
        const eta = bed[c] + h[c] - SL;
        h[c] = Math.max(0.05, h[c] + w * (target - eta));
        q[c + 1] += w * (c0 * target - q[c + 1]);
      }
    }
    for (let c = 1;c < Math.min(6, W - 1); c++) {
      if (h[c - 1] < 0.05 || h[c] < 0.05 || h[c + 1] < 0.05)
        continue;
      let flux = 0.12 * (bed[c] + h[c] - bed[c - 1] - h[c - 1]);
      flux = flux > 0 ? Math.min(flux, h[c] * 0.5) : Math.max(flux, -h[c - 1] * 0.5);
      h[c] -= flux;
      h[c - 1] += flux;
    }
  }
  stepSwash(dt) {
    const { W, h, bed, SL, t, rnd } = this;
    const swH = this.swH;
    const cov = this.swCov;
    swH.fill(0);
    cov.fill(0);
    this.swFoam.fill(0);
    for (let x = 0;x < W; x++)
      this.swBurst[x] *= Math.exp(-dt / 0.5);
    if (this.swX0 < 0)
      return;
    const x0 = this.swX0;
    const beachEnd = W - 2;
    const a = G * this.swSlope;
    const xt = Math.max(1, this.swX0i - 3);
    if (h[xt] > 0.05) {
      const eta = bed[xt] + h[xt] - SL;
      const u = this.velocity(xt);
      const thr = 0.3;
      if (this.swPrevEta < thr && eta >= thr && u > 0.5 && t - this.swLast > 0.6) {
        const depth = Math.max(0.4, h[xt]);
        let U0 = clamp(1.3 * Math.sqrt(G * depth) * (0.7 + 0.5 * clamp(eta, 0, 2)), 6, 32);
        const au = a * 1.25 + 2.5;
        const ad = a * 0.75 + 0.5;
        const maxR = Math.max(1, beachEnd - x0 - 1);
        if (U0 * U0 / (2 * au) > maxR)
          U0 = Math.sqrt(2 * au * maxR);
        const R = U0 * U0 / (2 * au);
        this.swEvents.push({ t0: t, U0, au, ad, H0: clamp(eta * 0.9 + 0.25, 0.4, 2.2), R, turned: false });
        this.swLast = t;
        if (this.swEvents.length > 6)
          this.swEvents.shift();
      }
      this.swPrevEta = eta;
    }
    const fronts = [];
    this.swEvents = this.swEvents.filter((e) => {
      const tau = t - e.t0;
      const tu = e.U0 / e.au;
      const td = Math.sqrt(2 * e.R / e.ad);
      let xf;
      let hc;
      const up = tau < tu;
      if (up) {
        xf = x0 + e.U0 * tau - 0.5 * e.au * tau * tau;
        hc = e.H0 * (1 - 0.55 * (tau / tu));
      } else {
        const tb = tau - tu;
        if (!e.turned) {
          e.turned = true;
          const xr = x0 + e.R;
          for (let x = Math.floor(xr) - 1;x <= Math.ceil(xr); x++)
            if (x >= 0 && x < W)
              this.foamLine[x] = Math.max(this.foamLine[x], 0.95);
        }
        xf = x0 + e.R - 0.5 * e.ad * tb * tb;
        hc = e.H0 * 0.45 * Math.pow(Math.max(0, 1 - tb / td), 0.7) + 0.06;
      }
      if (xf < x0 - 0.5)
        return false;
      fronts.push({ xf, up });
      const len = Math.max(0.5, xf - x0);
      for (let x = Math.max(0, Math.floor(x0));x <= Math.min(W - 1, Math.ceil(xf)); x++) {
        const xc = x + 0.5;
        const c = clamp(xf - x, 0, 1);
        if (c <= 0)
          continue;
        const xi = clamp((xc - x0) / len, 0, 1);
        const hh = Math.max(0.06, hc * Math.pow(1 - xi, 1.3) + 0.1 * c);
        if (hh > swH[x]) {
          swH[x] = hh;
          this.swTip[x] = xf - xc;
          this.swUp[x] = up ? 1 : 0;
          this.swFoam[x] = up ? Math.exp(-Math.max(0, xf - xc) / 2) * (1 - 0.5 * (tau / tu)) : 0.25 * Math.exp(-Math.max(0, xf - xc) / 1.2);
        }
        cov[x] = Math.max(cov[x], c);
      }
      return true;
    });
    for (const f1 of fronts) {
      if (!f1.up)
        continue;
      for (const f2 of fronts) {
        if (f2.up || Math.abs(f1.xf - f2.xf) > 1.2)
          continue;
        const x = clamp(Math.round(f1.xf), 0, W - 1);
        this.swBurst[x] = Math.min(1.5, this.swBurst[x] + 0.6);
        if (rnd() < 0.5)
          this.spawn(f1.xf, this.sandH[x] + 0.8, -2 + rnd() * 8, 10 + rnd() * 16, 0, 1.6);
      }
    }
    for (let x = 0;x < W; x++)
      this.swFoam[x] = Math.min(1.5, this.swFoam[x] + this.swBurst[x]);
  }
  velocity(i) {
    const hi = this.h[i];
    return hi > 0.05 ? (this.q[i] + this.q[i + 1]) / (2 * hi) : 0;
  }
  spawn(x, y, vx, vy, kind, life) {
    if (this.parts.length >= MAX_PARTICLES)
      return;
    this.parts.push({ x, y, vx, vy, kind, life });
  }
  breaking(dt) {
    const { W, h, bed, SL, foam, brk, mud, etaPrev, rnd } = this;
    for (let i = 1;i < W - 1; i++) {
      const eta = bed[i] + h[i];
      const etaT = (eta - etaPrev[i]) / dt;
      etaPrev[i] = eta;
      if (i < 24 && this.xs > 40) {
        brk[i] = 0;
        continue;
      }
      if (h[i] < 0.05) {
        brk[i] *= Math.exp(-dt / 0.2);
        continue;
      }
      const d = Math.max(0.3, SL - bed[i]);
      const c = Math.sqrt(G * d);
      const u = this.velocity(i);
      const was = brk[i];
      const crest = eta - SL;
      const depthLimited = crest > 0.45 * d && u > 1 && d < 7;
      if ((etaT > BRK_START * c && u > 0 || depthLimited) && d < 7.5) {
        const push = Math.max(etaT / c - BRK_START, depthLimited ? crest / d - 0.45 : 0);
        brk[i] = Math.min(1, brk[i] + push * 6 * dt + 0.25);
      } else if (etaT < BRK_STOP * c)
        brk[i] *= Math.exp(-dt / 0.45);
      else
        brk[i] *= Math.exp(-dt / 1.2);
      const b = brk[i];
      if (b < 0.05)
        continue;
      foam[i] = Math.min(1.8, foam[i] + 7 * b * dt);
      if (d < 5)
        mud[i] = Math.min(1, mud[i] + b * (5 - d) * 0.12 * dt);
      const onset = b - was;
      if (onset > 0.05 && d > 1.2 && rnd() < 0.85) {
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0;k < n; k++)
          this.spawn(i + rnd() * 0.8, eta + 0.3, u + c * (0.55 + rnd() * 0.35), 4 + rnd() * 12, 2, 1.2);
      }
      if (rnd() < 35 * b * dt)
        this.spawn(i + rnd(), eta + 0.5, u * 0.6 + (rnd() - 0.4) * 20, 18 + rnd() * 34 * b, 0, 2.5);
      if (rnd() < 28 * b * dt) {
        const depth = 0.6 + rnd() * Math.min(4, h[i] * 0.8);
        this.spawn(i + rnd(), eta - depth, u * 0.5, 2 + rnd() * 5, 3, 3);
      }
    }
    for (let i = Math.max(1, this.xs - 4);i < W - 1; i++) {
      const u = this.velocity(i);
      if (h[i] > 0.05 && h[i + 1] < 0.03 && u > 3) {
        foam[i] = Math.min(1.8, foam[i] + 5 * dt);
        if (rnd() < 5 * dt * Math.min(1, u / 15))
          this.spawn(i + rnd(), bed[i] + h[i] + 0.3, u * 0.5, 12 + rnd() * 16, 0, 2);
      }
    }
    if (this.xs >= W - 1) {
      const i = W - 1;
      const rise = bed[i] + h[i] - SL;
      const u = this.velocity(i - 1);
      if (rise > 1.2 && u > 2) {
        foam[i] = Math.min(1.8, foam[i] + 4 * dt);
        foam[i - 1] = Math.min(1.8, foam[i - 1] + 3 * dt);
        if (rnd() < 25 * dt * Math.min(1, rise / 3))
          this.spawn(i - rnd() * 2, bed[i] + h[i], -8 - rnd() * 22, 25 + rnd() * 40, 0, 2.5);
      }
    }
  }
  surfaceAt(x) {
    return this.h[x] > 0.05 ? this.bed[x] + this.h[x] : this.bed[x];
  }
  deposit(x, underwater) {
    const { W, H } = this;
    for (let iter = 0;iter < 6; iter++) {
      const c = this.sandH[x];
      const l = x > 0 ? this.sandH[x - 1] : 99;
      const r = x < W - 1 ? this.sandH[x + 1] : 99;
      if (l <= c - 2 && (l <= r || r > c - 2))
        x--;
      else if (r <= c - 2)
        x++;
      else
        break;
    }
    if (this.sandH[x] >= H - 2)
      return;
    const j = this.sandH[x];
    this.sandH[x] = j + 1;
    this.wet[j * W + x] = underwater ? 1 : 0.7;
    this.h[x] = Math.max(0, this.h[x] - 1);
    this.updateBed(x);
  }
  stepParticles(dt) {
    const { W, h, bed, parts, foam } = this;
    let n = 0;
    for (let k = 0;k < parts.length; k++) {
      const p = parts[k];
      const xi0 = Math.floor(p.x);
      const inW = xi0 >= 0 && xi0 < W;
      const inWater = inW && h[xi0] > 0.05 && p.y < bed[xi0] + h[xi0];
      if (p.kind === 3) {
        const u = inW ? this.velocity(xi0) : 0;
        p.vx += (u - p.vx) * Math.min(1, 4 * dt);
        p.vy = Math.min(9, p.vy + 14 * dt);
        p.x += Math.sin(p.life * 17) * 0.06;
      } else if (p.kind === 1 && inWater) {
        const u = this.velocity(xi0);
        p.vx += (u - p.vx) * Math.min(1, 3 * dt);
        p.vy = Math.max(p.vy - 30 * dt, -7);
      } else {
        p.vy -= PG * dt;
        p.vx *= 1 - 0.5 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const xi = Math.floor(p.x);
      if (xi < 0 || xi >= W)
        continue;
      if (p.kind === 3) {
        const s = this.surfaceAt(xi);
        if (h[xi] < 0.05 || p.y >= s - 0.2 || p.life <= 0) {
          foam[xi] = Math.min(1.8, foam[xi] + 0.12);
          continue;
        }
      } else if (p.kind === 0 || p.kind === 2) {
        const s = this.surfaceAt(xi);
        if (p.y <= s || p.life <= 0) {
          if (h[xi] > 0.3) {
            foam[xi] = Math.min(1.8, foam[xi] + (p.kind === 2 ? 0.5 : 0.3));
            if (p.kind === 2 && p.vx > 10 && this.rnd() < 0.5)
              this.spawn(p.x, s + 0.3, p.vx * 0.4, 10 + this.rnd() * 18, 0, 1.5);
          } else {
            const j = Math.max(0, this.sandH[xi] - 1);
            this.wet[j * W + xi] = Math.max(this.wet[j * W + xi], 0.95);
          }
          continue;
        }
      } else if (p.y <= bed[xi] || p.life <= 0) {
        this.deposit(xi, h[xi] > 0.05);
        continue;
      }
      parts[n++] = p;
    }
    parts.length = n;
  }
  advect(field, dt, outside) {
    const { W, tmp } = this;
    for (let x = 0;x < W; x++) {
      const src = x - this.velocity(x) * dt;
      const i0 = Math.floor(src);
      const f = src - i0;
      const a = i0 >= 0 && i0 < W ? field[i0] : outside(i0);
      const b = i0 + 1 >= 0 && i0 + 1 < W ? field[i0 + 1] : outside(i0 + 1);
      tmp[x] = a * (1 - f) + b * f;
    }
    field.set(tmp);
  }
  stepFields(dt) {
    const { W, h, foam, mud, lab, xi, sheen, foamLine, SL, bed } = this;
    this.advect(foam, dt, () => 0);
    const decay = Math.exp(-dt / 3.2);
    for (let x = 0;x < W; x++) {
      if (h[x] > 0.05)
        foam[x] *= decay;
      else {
        if (foam[x] > 0.25 && bed[x] > SL - 1)
          foamLine[x] = Math.max(foamLine[x], Math.min(1, foam[x]));
        foam[x] *= Math.exp(-dt / 0.3);
      }
      foamLine[x] *= h[x] > 0.05 ? Math.exp(-dt / 0.4) : Math.exp(-dt / 4.5);
    }
    this.advect(mud, dt, () => 0);
    const settle = Math.exp(-dt / 5);
    for (let x = 1;x < W - 1; x++)
      mud[x] = (mud[x] * 0.9 + 0.05 * (mud[x - 1] + mud[x + 1])) * settle;
    this.advect(lab, dt, (x) => x);
    for (let x = 0;x < W; x++)
      lab[x] += (x - lab[x]) * Math.min(1, dt / 12);
    const leak = Math.exp(-dt / 1.1);
    for (let x = 0;x < W; x++) {
      const d = Math.max(0, SL - bed[x]);
      const lim = clamp(d * 0.35, 0, 3.2);
      xi[x] = clamp((xi[x] + this.velocity(x) * dt) * leak, -lim, lim);
    }
    for (let x = 0;x < W; x++) {
      if (bed[x] > SL - 0.3 && h[x] > 0 && h[x] < 1.2)
        h[x] = Math.max(0, h[x] - (h[x] < 0.6 ? 0.5 : 0.25) * dt);
      else if (x > this.xs + 2 && bed[x] + h[x] > SL + 0.2 && h[x] > 0 && h[x] < 2.5)
        h[x] = Math.max(0, h[x] - 0.4 * dt);
      if (h[x] > 0 && bed[x] > SL - 2 && x > 1 && x < W - 2) {
        const dl = h[x - 1] < 0.03 && (h[x - 2] < 0.03 || h[x + 1] < 0.03);
        const dr = h[x + 1] < 0.03 && (h[x + 2] < 0.03 || h[x - 1] < 0.03);
        if (dl && dr)
          h[x] = Math.max(0, h[x] - 1.5 * dt);
      }
      if (x >= this.swX0i ? this.swCov[x] > 0.3 && this.swH[x] > 0.03 : h[x] > 0.05)
        sheen[x] = 1;
      else
        sheen[x] *= Math.exp(-dt / 0.9);
    }
  }
  stepSand(dt) {
    const { W, h, rnd } = this;
    const from = Math.max(1, Math.floor(this.xs - 30));
    for (let x = from;x < W - 1; x++) {
      if (this.sandH[x] < 2 || h[x] < 0.05 || h[x] > 3)
        continue;
      if (this.sandH[x] <= Math.min(this.sandH[x - 1], this.sandH[x + 1]))
        continue;
      const u = this.velocity(x);
      const au = Math.abs(u);
      if (au > 16 && rnd() < (au - 16) * 0.03 * dt && this.parts.length < MAX_PARTICLES) {
        this.sandH[x]--;
        h[x] += 1;
        this.updateBed(x);
        this.mud[x] = Math.min(1, this.mud[x] + 0.15);
        this.parts.push({ x: x + 0.5, y: this.sandH[x] + 0.5, vx: u * 0.5, vy: 6 + rnd() * 6, kind: 1, life: 6 });
      }
    }
    for (let x = 1;x < W - 2; x++) {
      const a = this.sandH[x];
      const b = this.sandH[x + 1];
      const l = this.sandH[x - 1];
      const r = this.sandH[x + 2];
      if (a < 1 || b < 1 || Math.max(a, b) >= Math.min(l, r))
        continue;
      const into = a <= b ? x : x + 1;
      const donor = l >= r ? x - 1 : x + 2;
      const c = this.sandH[into];
      this.sandH[donor]--;
      this.sandH[into]++;
      this.wet[c * W + into] = this.wet[this.sandH[donor] * W + donor];
      this.h[into] = Math.max(0, this.h[into] - 1);
      if (this.h[donor] > 0.05)
        this.h[donor] += 1;
      this.updateBed(into);
      this.updateBed(donor);
    }
    for (let x = 1;x < W - 1; x++) {
      const c = this.sandH[x];
      const l = this.sandH[x - 1];
      const r = this.sandH[x + 1];
      if (c < 1 || c >= Math.min(l, r))
        continue;
      const donor = l >= r ? x - 1 : x + 1;
      this.sandH[donor]--;
      this.sandH[x]++;
      this.wet[c * W + x] = this.wet[this.sandH[donor] * W + donor];
      this.h[x] = Math.max(0, this.h[x] - 1);
      if (this.h[donor] > 0.05)
        this.h[donor] += 1;
      this.updateBed(x);
      this.updateBed(donor);
    }
    for (let k = 0;k < 5; k++) {
      if (rnd() > 2.5 * dt)
        continue;
      const x = k < 3 ? Math.floor(rnd() * W) : clamp(Math.floor(this.xs - 10 + rnd() * 50), 0, W - 1);
      const target = Math.max(0, Math.round(this.prof[x]));
      if (this.sandH[x] < target - 1)
        this.deposit(x, h[x] > 0.05);
      else if (this.sandH[x] > target + 1 && h[x] < 0.05) {
        this.sandH[x]--;
        this.updateBed(x);
      }
    }
  }
  stepWet(dt) {
    const { W, h, bed, SL, wet } = this;
    for (let x = 0;x < W; x++) {
      const top = this.sandH[x];
      if (top <= 0)
        continue;
      const onBeach = x >= this.swX0i;
      const covered = onBeach ? this.swCov[x] > 0.3 && this.swH[x] > 0.03 ? top + this.swH[x] : -1 : h[x] > 0.05 ? bed[x] + h[x] : -1;
      for (let j = 0;j < top; j++) {
        const idx = j * W + x;
        if (j + 0.5 < covered) {
          wet[idx] = 1;
          continue;
        }
        const floor = j + 0.5 < SL - 0.8 ? 0.85 : 0;
        const fromTop = top - 1 - j;
        const rate = 0.09 * Math.pow(0.35, fromTop);
        wet[idx] = Math.max(floor, wet[idx] - rate * dt);
      }
    }
  }
  render(buf) {
    const T = this.th;
    const { W, H, h, bed, foam, wet, t, SL, xi, lab, mud, sheen, foamLine } = this;
    const put = (o, r, g, b) => {
      buf[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      buf[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      buf[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      buf[o + 3] = 255;
    };
    const murk = T.murk ?? [
      (T.waterTop[0] + T.sandWet[0]) * 0.5,
      (T.waterTop[1] + T.sandWet[1]) * 0.5,
      (T.waterTop[2] + T.sandWet[2]) * 0.45
    ];
    const frame = Math.floor(t * 12);
    const horizonRow = H - SL;
    const moonX = Math.round(W * 0.78);
    const wetAt = (i) => i >= 0 && i < W && h[i] > 0.02;
    const etaAt = (s, own) => {
      const i0 = clamp(Math.floor(s), 0, W - 1);
      const i1 = Math.min(W - 1, i0 + 1);
      const f = clamp(s - i0, 0, 1);
      const w0 = wetAt(i0);
      const w1 = wetAt(i1);
      if (!w0 && !w1)
        return own;
      if (!w0)
        return bed[i1] + h[i1];
      if (!w1)
        return bed[i0] + h[i0];
      return bed[i0] + h[i0] + (bed[i1] + h[i1] - bed[i0] - h[i0]) * f;
    };
    const sR = this.surfR;
    const siR = this.srcR;
    const ripR = this.ripR;
    for (let x = 0;x < W; x++) {
      if (!wetAt(x)) {
        sR[x] = -1;
        siR[x] = x;
        ripR[x] = 0;
        continue;
      }
      if (x >= this.swX0i) {
        sR[x] = -1;
        siR[x] = x;
        ripR[x] = 0;
        this.visR[x] = 0;
        continue;
      }
      const own = bed[x] + h[x];
      const was = this.visR[x] === 1;
      let show = was ? h[x] >= 0.14 : h[x] >= 0.32;
      if (show && !was && bed[x] > SL - 2) {
        const pv = (i) => i >= 0 && i < W && this.visR[i] === 1;
        const lone = !pv(x - 1) && !pv(x + 1) && h[x - 1 < 0 ? 0 : x - 1] < 0.32 && h[x + 1 >= W ? W - 1 : x + 1] < 0.32;
        if (lone)
          show = false;
      }
      if (!show) {
        sR[x] = -1;
        siR[x] = x;
        ripR[x] = 0;
        continue;
      }
      let s = x;
      for (let it = 0;it < 2; it++)
        s = x - xi[clamp(Math.round(s), 0, W - 1)];
      if (!wetAt(clamp(Math.round(s), 0, W - 1)))
        s = x;
      siR[x] = clamp(Math.round(s), 0, W - 1);
      const L0 = lab[siR[x]];
      ripR[x] = Math.sin(L0 * 1.9 - t * 6.5) * 0.6 + Math.sin(L0 * 3.3 + t * 4.1) * 0.4;
      let e = etaAt(s, own) + ripR[x] * 0.06;
      if (h[x] < 0.6)
        e = Math.min(e, own + 0.3);
      sR[x] = e;
    }
    for (let x = 1;x < W - 1; x++) {
      if (sR[x] < 0 || sR[x - 1] < 0 || sR[x + 1] < 0)
        continue;
      const lo = Math.min(sR[x - 1], sR[x + 1]);
      const hi = Math.max(sR[x - 1], sR[x + 1]);
      if (sR[x] < lo - 0.5)
        sR[x] = lo - 0.2;
      else if (sR[x] > hi + 1.6)
        sR[x] = hi + 1.6;
    }
    const fill = this.fillR;
    for (let x = 0;x < W; x++) {
      const was = fill[x] === 1;
      fill[x] = 0;
      if (sR[x] >= 0 || x >= this.swX0i)
        continue;
      const top = this.sandH[x];
      const l = x > 0 ? sR[x - 1] : -1;
      const r = x < W - 1 ? sR[x + 1] : -1;
      const lvl = Math.max(l, r);
      if (lvl < 0)
        continue;
      const head = lvl - top;
      if (head > (was ? 0.15 : 0.6)) {
        sR[x] = Math.min(lvl, top + 1.2);
        siR[x] = x;
        fill[x] = 1;
      }
    }
    const prevS = this.surfPrev;
    for (let x = 0;x < W; x++) {
      const on = sR[x] >= 0;
      if (on && prevS[x] >= 0 && x > this.xs - 25)
        sR[x] = prevS[x] * 0.4 + sR[x] * 0.6;
      this.visR[x] = on && fill[x] === 0 ? 1 : 0;
      prevS[x] = sR[x];
    }
    const sAt = (i, fallback) => i >= 0 && i < W && sR[i] >= 0 ? sR[i] : fallback;
    for (let x = 0;x < W; x++) {
      const sandTop = this.sandH[x];
      const wetCol = sR[x] >= 0;
      const si = siR[x];
      const L0 = lab[si];
      const ripple = ripR[x];
      const surf = wetCol ? sR[x] : -1;
      const slope = wetCol ? sAt(x + 1, surf) - sAt(x - 1, surf) : 0;
      const curv = wetCol ? sAt(x + 2, surf) + sAt(x - 2, surf) - 2 * surf : 0;
      const f = foam[si];
      const md = mud[x];
      for (let r = 0;r < H; r++) {
        const yu = H - r - 0.5;
        const o = (r * W + x) * 4;
        const j = H - 1 - r;
        if (j < sandTop) {
          const w = wet[j * W + x];
          let cr = T.sandDry[0] + (T.sandWet[0] - T.sandDry[0]) * w;
          let cg = T.sandDry[1] + (T.sandWet[1] - T.sandDry[1]) * w;
          let cb = T.sandDry[2] + (T.sandWet[2] - T.sandDry[2]) * w;
          const gh = hash2(x, j);
          const down = Math.min(1, (sandTop - 1 - j) / 7);
          const n = (1 + (gh - 0.5) * 0.09) * (1 - 0.13 * down);
          cr *= n;
          cg *= n;
          cb *= n;
          if (T.shells && gh > 0.985 && w < 0.5) {
            const sh = gh > 0.993 ? T.shellB : T.shellA;
            cr = sh[0];
            cg = sh[1];
            cb = sh[2];
          }
          const top = j === sandTop - 1;
          if (top && !wetCol) {
            if (w < 0.3) {
              cr += (255 - cr) * 0.25;
              cg += (250 - cg) * 0.25;
              cb += (236 - cb) * 0.2;
              if (hash2(x * 7 + frame, j) > 0.995) {
                cr = 255;
                cg = 250;
                cb = 236;
              }
            }
            const sh = sheen[x] * 0.55;
            if (sh > 0.02) {
              cr += (T.skyGlow[0] + 60 - cr) * sh;
              cg += (T.skyGlow[1] + 80 - cg) * sh;
              cb += (T.skyGlow[2] + 90 - cb) * sh;
            }
            if (foamLine[x] > 0.05 && vnoise(x * 0.9, frame * 0.02 + 3) < foamLine[x] * 0.8) {
              cr += (T.foam[0] - cr) * 0.7;
              cg += (T.foam[1] - cg) * 0.7;
              cb += (T.foam[2] - cb) * 0.7;
            }
          }
          if (wetCol && surf > yu) {
            const above = surf - yu;
            const caus = clamp(-curv * 1.6 + (vnoise(lab[x] * 0.35, t * 0.9) - 0.5) * 0.5, -0.25, 0.6) * Math.exp(-above / 4);
            cr *= 1 + caus * 0.35;
            cg *= 1 + caus * 0.35;
            cb *= 1 + caus * 0.3;
            const sh = Math.min(1, above / 2.5) * 0.7;
            cr += (T.shallow[0] - cr) * sh;
            cg += (T.shallow[1] - cg) * sh;
            cb += (T.shallow[2] - cb) * sh;
            const dp = Math.min(1, Math.max(0, above - 2) / 7) * 0.8;
            cr += (T.waterDeep[0] - cr) * dp;
            cg += (T.waterDeep[1] - cg) * dp;
            cb += (T.waterDeep[2] - cb) * dp;
            if (md > 0.02) {
              const m = md * 0.55;
              cr += (murk[0] - cr) * m;
              cg += (murk[1] - cg) * m;
              cb += (murk[2] - cb) * m;
            }
          }
          put(o, cr, cg, cb);
          continue;
        }
        const k = clamp(r / horizonRow, 0, 1);
        let sr = T.skyTop[0] + (T.skyLow[0] - T.skyTop[0]) * k;
        let sg = T.skyTop[1] + (T.skyLow[1] - T.skyTop[1]) * k;
        let sb = T.skyTop[2] + (T.skyLow[2] - T.skyTop[2]) * k;
        const glow = Math.max(0, 1 - Math.abs(r - (horizonRow - 1)) / 3) * 0.6;
        sr += (T.skyGlow[0] - sr) * glow;
        sg += (T.skyGlow[1] - sg) * glow;
        sb += (T.skyGlow[2] - sb) * glow;
        if (r < horizonRow - 4) {
          const st = hash2(x, r + 991);
          if (T.stars > 0 && st > 1 - T.stars) {
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.6 + st * 3) + x));
            sr += 110 * tw;
            sg += 105 * tw;
            sb += 120 * tw;
          }
        }
        const cover = wetCol ? clamp(surf - (yu - 0.5), 0, 1) : 0;
        if (cover <= 0) {
          put(o, sr, sg, sb);
          continue;
        }
        const d = Math.max(0, surf - yu);
        const dk = Math.min(1, d / 9);
        let wr = T.waterTop[0] + (T.waterDeep[0] - T.waterTop[0]) * dk;
        let wg = T.waterTop[1] + (T.waterDeep[1] - T.waterTop[1]) * dk;
        let wb = T.waterTop[2] + (T.waterDeep[2] - T.waterTop[2]) * dk;
        const lift = yu - SL;
        if (lift > 0) {
          const k2 = Math.min(1, lift / 3) * (0.3 + Math.min(0.4, Math.max(0, -slope) * 0.25));
          wr += (T.shallow[0] + 40 - wr) * k2;
          wg += (T.shallow[1] + 30 - wg) * k2;
          wb += (T.shallow[2] + 10 - wb) * k2;
        }
        const shade = clamp(slope * 9, -16, 16) * (1 - dk);
        const c = vnoise(lab[x] * 0.07 + d * 0.12, t * 0.5 + d * 0.1) - 0.5;
        const cs = c * 14 * (1 - dk) + shade;
        wr += cs;
        wg += cs;
        wb += cs;
        if (md > 0.02) {
          const m = md * (0.35 + 0.4 * dk);
          wr += (murk[0] - wr) * m;
          wg += (murk[1] - wg) * m;
          wb += (murk[2] - wb) * m;
        }
        if (d < 1) {
          const hl = 0.34 + 0.14 * ripple;
          wr += (T.crest[0] - wr) * hl;
          wg += (T.crest[1] - wg) * hl;
          wb += (T.crest[2] - wb) * hl;
          const gl = !T.glitterOn ? 2 : T.moon && Math.abs(x - moonX) < 14 ? 0.8 + Math.abs(x - moonX) * 0.012 : 0.972;
          if (hash2(Math.round(L0 * 2) + frame * 13, 77) > gl) {
            wr = T.glitter[0];
            wg = T.glitter[1];
            wb = T.glitter[2];
          }
        }
        if (f > 0.03) {
          const lace = vnoise(L0 * 0.75, r * 0.9 + t * 0.35) * 0.65 + vnoise(L0 * 2.1, r * 2.3 - t * 0.6) * 0.35;
          const fz = d < 1.2 ? f : d < 2.4 ? f * 0.6 : f * 0.22 * Math.exp(-(d - 2.4) / 3);
          if (lace < fz * 0.85) {
            const m = Math.min(1, 0.45 + fz * 0.45);
            wr += (T.foam[0] - wr) * m;
            wg += (T.foam[1] - wg) * m;
            wb += (T.foam[2] - wb) * m;
          }
        }
        if (h[x] < 1.2 && sandTop > 0) {
          const film = (1 - h[x] / 1.2) * 0.35;
          wr += (T.shallow[0] + 40 - wr) * film;
          wg += (T.shallow[1] + 25 - wg) * film;
          wb += (T.shallow[2] + 20 - wb) * film;
        }
        put(o, sr + (wr - sr) * cover, sg + (wg - sg) * cover, sb + (wb - sb) * cover);
      }
    }
    if (this.swX0 >= 0)
      this.renderSwash(buf, frame);
    if (!this.debugOverlays)
      return;
    this.renderProps(put, buf);
    for (const p of this.parts) {
      const x = Math.floor(p.x);
      const r = H - 1 - Math.floor(p.y);
      if (x < 0 || x >= W || r < 0 || r >= H)
        continue;
      const o = (r * W + x) * 4;
      if (p.kind === 0)
        put(o, T.spray[0], T.spray[1], T.spray[2]);
      else if (p.kind === 2) {
        const m = clamp(1.2 - p.life, 0, 1) * 0.6;
        put(o, T.shallow[0] + (T.foam[0] - T.shallow[0]) * m + 20, T.shallow[1] + (T.foam[1] - T.shallow[1]) * m + 20, T.shallow[2] + (T.foam[2] - T.shallow[2]) * m + 10);
      } else if (p.kind === 3) {
        buf[o] = buf[o] + (T.foam[0] - buf[o]) * 0.45;
        buf[o + 1] = buf[o + 1] + (T.foam[1] - buf[o + 1]) * 0.45;
        buf[o + 2] = buf[o + 2] + (T.foam[2] - buf[o + 2]) * 0.45;
      } else
        put(o, T.sandWet[0], T.sandWet[1], T.sandWet[2]);
    }
    const g = this.gull;
    if (g.x > -50) {
      const gx = Math.round(g.x);
      const gy = g.y + (Math.sin(t * 2.1) > 0.6 ? 1 : 0);
      const up = Math.floor(t * 5) % 2 === 0;
      const px = (x, r) => {
        if (x >= 0 && x < W && r >= 0 && r < H)
          put((r * W + x) * 4, T.gull[0], T.gull[1], T.gull[2]);
      };
      px(gx, gy);
      px(gx - 1, up ? gy - 1 : gy);
      px(gx + 1, up ? gy - 1 : gy);
    }
  }
  renderSwash(buf, frame) {
    const T = this.th;
    const { W, H, t } = this;
    const blend = (o, c, a) => {
      if (a <= 0)
        return;
      buf[o] = buf[o] + (c[0] - buf[o]) * a;
      buf[o + 1] = buf[o + 1] + (c[1] - buf[o + 1]) * a;
      buf[o + 2] = buf[o + 2] + (c[2] - buf[o + 2]) * a;
    };
    const sheetUp = [T.shallow[0] + 30, T.shallow[1] + 22, T.shallow[2] + 16];
    const sheetBack = [T.shallow[0] - 6, T.shallow[1] + 4, T.shallow[2] + 10];
    const deepC = [(T.shallow[0] + T.waterDeep[0]) / 2, (T.shallow[1] + T.waterDeep[1]) / 2, (T.shallow[2] + T.waterDeep[2]) / 2];
    for (let x = Math.max(0, Math.floor(this.swX0));x < W; x++) {
      const c = this.swCov[x];
      const hs = this.swH[x];
      if (c <= 0.01 || hs <= 0.02)
        continue;
      const sandTop = this.sandH[x];
      const rTop = H - sandTop;
      const base = this.swUp[x] ? sheetUp : sheetBack;
      const aT = clamp(0.32 + hs * 0.55, 0.32, 0.85) * c;
      if (rTop >= 0 && rTop < H)
        blend((rTop * W + x) * 4, base, aT);
      if (rTop + 1 >= 0 && rTop + 1 < H)
        blend(((rTop + 1) * W + x) * 4, base, aT * 0.3);
      const surf = sandTop + hs;
      let topRow = rTop;
      for (let k = 0;k < 4; k++) {
        const r = rTop - 1 - k;
        if (r < 0)
          break;
        const vcov = clamp(surf - (sandTop + k), 0, 1);
        if (vcov <= 0)
          break;
        const depth = hs - k;
        const col = depth > 1.6 ? deepC : base;
        blend((r * W + x) * 4, col, vcov * c * 0.92);
        topRow = r;
      }
      const fo = this.swFoam[x];
      if (fo > 0.04) {
        const lace = vnoise((this.swTip[x] + x * 0.15) * 0.9, t * 0.8 + x * 0.05) * 0.7 + vnoise(x * 1.7, t * 1.9) * 0.3;
        if (lace < fo * 0.9)
          blend((topRow * W + x) * 4, T.foam, Math.min(0.95, 0.5 + fo * 0.4) * c);
        if (fo > 0.6 && topRow + 1 < H && lace < fo * 0.5)
          blend(((topRow + 1) * W + x) * 4, T.foam, 0.45 * c);
      }
      if (T.glitterOn && this.swUp[x] && hash2(x * 31 + frame * 7, 11) > 0.985)
        blend((topRow * W + x) * 4, T.glitter, 0.8 * c);
    }
  }
  renderProps(put, buf) {
    const T = this.th;
    const { W, H, t } = this;
    const px = (x, r, c, m = 1) => {
      const xi = Math.round(x);
      const ri = Math.round(r);
      if (xi < 0 || xi >= W || ri < 0 || ri >= H)
        return;
      put((ri * W + xi) * 4, c[0] * m, c[1] * m, c[2] * m);
    };
    const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const pxa = (x, r, c, m = 1) => {
      const xi = Math.round(x);
      if (Math.round(r) >= this.groundRow(xi))
        return;
      px(xi, r, c, m);
    };
    const wind = 0.55 + 0.45 * Math.sin(t * 0.23);
    if (T.moon) {
      const mx = Math.round(W * 0.78);
      const my = 3;
      const halo = [T.skyLow[0] + 30, T.skyLow[1] + 34, T.skyLow[2] + 44];
      for (const [dx, dy] of [[-2, 0], [-2, 1], [3, 0], [3, 1], [0, -2], [1, -2], [0, 3], [1, 3]])
        px(mx + dx, my + dy, halo);
      for (let dy = -1;dy <= 2; dy++) {
        for (let dx = -1;dx <= 2; dx++) {
          const corner = (dx === -1 || dx === 2) && (dy === -1 || dy === 2);
          if (corner)
            px(mx + dx, my + dy, halo);
          else
            px(mx + dx, my + dy, [236, 238, 226], dx + dy >= 2 ? 0.86 : 1);
        }
      }
      px(mx, my, [212, 214, 204]);
    }
    for (const b of this.bushes) {
      const half = (b.w - 1) / 2;
      for (let dx = 0;dx < b.w; dx++) {
        const u = (dx - half) / (half + 1);
        const hc = Math.max(1, Math.round(3.2 * Math.sqrt(Math.max(0, 1 - u * u))));
        const g = this.groundRow(b.x + dx);
        for (let k = 0;k < hc; k++) {
          const top = k === hc - 1;
          const leafy = hash2(b.x * 3 + dx, k * 7 + 1) > 0.45;
          let c = T.bush;
          let m = 1;
          if (top && dx <= half)
            c = T.bushLight;
          else if (top)
            m = 0.95;
          else if (k === 0)
            m = 0.78;
          if (!top && leafy && (dx + k) % 2 === 0)
            c = mixc(T.bush, T.bushLight, 0.55);
          if (top && hash2(b.x + dx, Math.floor(t * 3 + b.ph)) > 0.82)
            c = mixc(T.bushLight, [230, 255, 200], 0.25);
          pxa(b.x + dx, g - 1 - k, c, m);
          if (k === 0 && hash2(b.x * 11 + dx, 5) > 0.8)
            pxa(b.x + dx, g - 1 - k, [112, 58, 124]);
        }
      }
    }
    for (const tf of this.tufts) {
      const g = this.groundRow(tf.x);
      const bend = Math.sin(t * 1.9 + tf.ph) * wind;
      const blades = [
        [0, tf.h],
        [1, Math.max(1, tf.h - 1)],
        [-1, Math.max(1, tf.h - 1)]
      ];
      for (const [bx, bh] of blades) {
        for (let k = 0;k < bh; k++) {
          const lean = k === bh - 1 && bh > 1 ? bend > 0.25 ? 1 : bend < -0.35 ? -1 : 0 : 0;
          pxa(tf.x + bx + lean, g - 1 - k, k === bh - 1 ? T.grassTip : T.grass, bx === 0 ? 1 : 0.88);
        }
      }
    }
    if (this.tower) {
      const tw = this.tower;
      const g = this.groundRow(tw.x + 2);
      for (let k = 1;k <= 3; k++) {
        px(tw.x, g - k, T.towerLeg);
        px(tw.x + 4, g - k, T.towerLeg);
      }
      px(tw.x - 1, g - 1, T.towerLeg, 0.8);
      px(tw.x - 2, g - 1, T.towerLeg, 0.7);
      for (let dx = 0;dx <= 4; dx++) {
        for (let k = 4;k <= 6; k++)
          px(tw.x + dx, g - k, tw.color, k === 6 ? 0.82 : 1);
      }
      px(tw.x + 2, g - 5, [40, 50, 70]);
      for (let dx = -1;dx <= 5; dx++)
        px(tw.x + dx, g - 7, dx % 2 === 0 ? [250, 250, 250] : tw.color, 0.95);
      px(tw.x + 2, g - 8, T.towerLeg);
      px(tw.x + 3, g - 9, [236, 72, 64]);
      if (Math.sin(t * 4 + tw.x) > 0)
        px(tw.x + 4, g - 9, [236, 72, 64]);
    }
    for (const p of this.palms)
      this.drawPalm(p, buf, wind);
  }
  static FRONDS = [
    [[-1, 0, "G", false], [-2, -1, "L", false], [-3, -2, "L", false], [-4, -2, "L", false], [-5, -2, "G", false], [-6, -1, "G", true], [-7, 0, "D", true]],
    [[1, 0, "G", false], [2, -1, "L", false], [3, -2, "L", false], [4, -2, "L", false], [5, -2, "L", false], [6, -2, "G", false], [7, -1, "G", true], [8, 0, "D", true]],
    [[1, 0, "G", false], [2, 0, "G", false], [3, 0, "G", false], [4, 1, "G", false], [5, 1, "D", true], [6, 2, "D", true]],
    [[-1, 0, "G", false], [-2, 0, "G", false], [-3, 0, "G", false], [-4, 1, "G", false], [-5, 2, "D", false], [-6, 3, "D", true], [-6, 4, "D", true]],
    [[-1, 0, "G", false], [-2, 1, "D", false], [-3, 2, "D", true], [-3, 3, "D", true]]
  ];
  static SPEAR = [[0, -1, "G"], [0, -2, "L"], [0, -3, "S"], [0, -4, "S"]];
  drawPalm(p, buf, wind) {
    const T = this.th;
    const { W, H, t } = this;
    const g = this.groundRow(p.x);
    const put = (x, r, c, clip = true) => {
      const xi = Math.round(x);
      const ri = Math.round(r);
      if (xi < 0 || xi >= W || ri < 0 || ri >= H)
        return;
      if (clip && ri >= this.groundRow(xi))
        return;
      const o = (ri * W + xi) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    };
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const big = p.size > 1;
    const trunkH = Math.max(4, Math.min(big ? 7 : 6, g - 5));
    const lean = Math.max(-2, Math.min(2, Math.round(p.lean * 0.6)));
    const lit = mix(T.trunk, [255, 226, 180], 0.2);
    let cx = p.x;
    for (let s = 0;s < trunkH; s++) {
      const u = s / (trunkH - 1);
      const x = Math.round(p.x + lean * u * u);
      put(x, g - 1 - s, s % 2 === 0 ? lit : T.trunkRing, false);
      cx = x;
    }
    put(p.x + (lean < 0 ? 1 : -1), g - 1, T.trunkRing, false);
    const cy = g - 1 - trunkH;
    const C = {
      L: T.frondTip,
      G: mix(T.frondBase, T.frondTip, 0.5),
      D: T.frondBase,
      S: mix(T.frondTip, [236, 255, 170], 0.45)
    };
    const ph = Math.sin(t * 1.6 + p.ph) * (0.5 + wind * 0.6);
    const flick = ph > 0.55 ? -1 : ph < -0.55 ? 1 : 0;
    const dir = lean > 0 || lean === 0 && p.ph > Math.PI ? -1 : 1;
    for (const frond of PixelSea.FRONDS) {
      const len = frond.length;
      frond.forEach(([fx, fy, k, tip], i) => {
        put(cx + dir * fx, cy + fy + (tip ? flick : 0), C[k]);
        if (big && i === len - 1)
          put(cx + dir * (fx + Math.sign(fx || 1)), cy + fy + 1 + (tip ? flick : 0), C.D);
      });
    }
    for (const [fx, fy, k] of PixelSea.SPEAR)
      put(cx + dir * fx, cy + fy, C[k]);
    put(cx, cy, C.D);
    put(cx - 1, cy + 1, T.coconut);
    put(cx + 1, cy + 1, mix(T.coconut, [255, 220, 160], 0.25));
  }
}

// ../plugins/quota-lab/themes.ts
var MOONLIT_LAGOON = {
  ...MIAMI_DUSK,
  skyTop: [5, 7, 18],
  skyLow: [12, 20, 42],
  skyGlow: [22, 34, 66],
  waterTop: [36, 112, 146],
  waterDeep: [3, 16, 34],
  shallow: [34, 104, 128],
  crest: [110, 200, 226],
  foam: [110, 255, 236],
  glitter: [214, 228, 255],
  sandDry: [148, 150, 162],
  sandWet: [86, 90, 104],
  shellA: [204, 210, 222],
  shellB: [176, 166, 198],
  spray: [130, 255, 236],
  trunk: [36, 32, 42],
  trunkRing: [24, 22, 30],
  frondBase: [12, 28, 30],
  frondTip: [28, 54, 52],
  coconut: [18, 16, 22],
  bush: [14, 30, 30],
  bushLight: [24, 46, 42],
  grass: [40, 62, 58],
  grassTip: [64, 90, 82],
  towerColors: [
    [84, 74, 124],
    [64, 104, 124]
  ],
  towerLeg: [112, 116, 134],
  gull: [168, 174, 192],
  moon: true,
  stars: 0.012
};
var TURQUOISE_TANK = {
  ...MIAMI_DUSK,
  skyTop: [15, 16, 22],
  skyLow: [26, 33, 45],
  skyGlow: [26, 33, 45],
  waterTop: [70, 200, 190],
  waterDeep: [6, 39, 43],
  shallow: [60, 172, 162],
  crest: [196, 248, 240],
  foam: [236, 253, 250],
  sandDry: [214, 175, 108],
  sandWet: [132, 101, 60],
  props: false,
  shells: false,
  glitterOn: false,
  stars: 0.007
};

// entry.ts
globalThis.PixelSea = PixelSea;
globalThis.THEMES = { miami: MIAMI_DUSK, lagoon: MOONLIT_LAGOON, tank: TURQUOISE_TANK };
