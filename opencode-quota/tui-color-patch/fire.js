// __quotaFirePatchV20__ burning token numbers + turquoise water-tank quota bars (exact mode solution with wall-splash micro-physics), classic name/bar rows.
var QUOTA_FIRE_PALETTE = ["#6E1400", "#A31D00", "#D93600", "#FF5A00", "#FF8A00", "#FFB733", "#FFE594"];
var QUOTA_FIRE_BAYER = [[0, 2], [3, 1]];
function quotaFireHash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function quotaFireTokenCountsLine(line) {
  return /\b\d[\d.]*[KMB]?\)?\s+(?:in|out)\b/u.test(line);
}
function quotaTokenFireBurnMask(chars) {
  const burn = new Array(chars.length).fill(false);
  let runStart = -1;
  let runHasDigit = false;
  for (let i = 0; i <= chars.length; i++) {
    const isNumChar = i < chars.length && /[0-9KMB.()]/u.test(chars[i]);
    if (isNumChar) {
      if (runStart < 0) {
        runStart = i;
        runHasDigit = false;
      }
      if (/[0-9]/u.test(chars[i])) runHasDigit = true;
    } else if (runStart >= 0) {
      if (runHasDigit) for (let j = runStart; j < i; j++) burn[j] = true;
      runStart = -1;
    }
  }
  return burn;
}
function quotaTokenFireSegments(line) {
  const chars = Array.from(line);
  const burnMask = quotaTokenFireBurnMask(chars);
  const splitIndex = line.indexOf(" in");
  const segments = [];
  let mutedRun = "";
  for (let index = 0; index < chars.length; index++) {
    if (burnMask[index]) {
      if (mutedRun) {
        segments.push({ text: mutedRun, burn: false });
        mutedRun = "";
      }
      segments.push({
        text: chars[index],
        burn: true,
        index,
        seed: splitIndex >= 0 && index > splitIndex ? 9 : 3
      });
    } else {
      mutedRun += chars[index];
    }
  }
  if (mutedRun) segments.push({ text: mutedRun, burn: false });
  return segments;
}
function quotaTokenFireColor(index, phase, seed) {
  const t = phase * 0.5;
  const heat =
    0.84 +
    0.15 * Math.sin(index * 0.7 + t * 1.3 + seed) +
    0.11 * Math.sin(index * 0.27 - t * 0.9 + seed * 2.3) +
    0.07 * (quotaFireHash(index * 11.7 + Math.floor(t) * 3.1 + seed * 7.9) - 0.5);
  const dithered = heat + (QUOTA_FIRE_BAYER[index & 1][(index + Math.floor(phase / 2)) & 1] / 4 - 0.375) * 0.3;
  const clamped = Math.max(0.01, Math.min(0.999, dithered));
  return QUOTA_FIRE_PALETTE[Math.floor(clamped * QUOTA_FIRE_PALETTE.length)];
}
var QUOTA_BAR_RE = /^([█]+)([░]*)\s+(\d+)%\s*(left|used)?\s*$/u;
var quotaFxPhasePair = createSignal(0);
var quotaFxPhase = quotaFxPhasePair[0];
var setQuotaFxPhase = quotaFxPhasePair[1];
var quotaFxClockStarted = false;
function startQuotaFxClock() {
  if (quotaFxClockStarted) return;
  quotaFxClockStarted = true;
  setInterval(() => setQuotaFxPhase((value) => (value + 1) % 100000), 120);
}
function quotaBarLine(line) {
  return QUOTA_BAR_RE.test(line);
}
function quotaClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function quotaPadRight(str, width) {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
function quotaPadLeft(str, width) {
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}
function quotaColorInts(value) {
  if (typeof value === "string") {
    const match = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/iu);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  if (value && typeof value === "object") {
    if (typeof value.toInts === "function") {
      try {
        const ints = value.toInts();
        if (Array.isArray(ints) && ints.length >= 3) return [ints[0], ints[1], ints[2]];
      } catch {
        // Fall through to the r/g/b shape below.
      }
    }
    const r = value.r;
    const g = value.g;
    const b = value.b;
    if ([r, g, b].every((n) => typeof n === "number" && Number.isFinite(n))) {
      const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
      return [r * scale, g * scale, b * scale];
    }
  }
  return null;
}
function quotaMixColor(from, to, amount) {
  const a = quotaColorInts(from);
  const b = quotaColorInts(to);
  if (!a || !b) return from;
  const mixed = a.map((value, index) => Math.max(0, Math.min(255, Math.round(value + (b[index] - value) * amount))));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
function quotaBarBucketColor(percent, mode, theme) {
  const text = theme && theme.text ? theme.text : {};
  const feedback = text.feedback ? text.feedback : {};
  const base = (entry) => (entry && entry.base !== undefined ? entry.base : undefined);
  const remaining = mode === "used" ? 100 - percent : percent;
  const bucket = remaining < 30 ? base(feedback.error) : remaining < 70 ? base(feedback.warning) : base(feedback.success);
  return bucket !== undefined ? bucket : text.muted;
}

// ---- water-tank quota bar (turquoise seiche, 1 row) ----
// The bar is a real wave tank, evaluated per frame from the exact solution of
// the 1D wave equation with reflecting walls: 12 standing modes, each an exact
// pair of opposite-travelling waves, obeying the deep-water dispersion law
// (omega ~ sqrt(n) - short waves run faster). Antinodes sit on both walls
// (clapotis: crests double at the edges and re-launch); a Stokes-type second
// order term sharpens crests; two coherent capillary harmonics ride on top.
// Wall splash micro-physics: surface-history scanning detects impact events
// (peak rise rate at each wall), then run-up overshoot, a fast rebound jet,
// a ballistic ejecta train walking inboard, clinging run-down (run-down is a
// fraction of run-up) and an impact foam bloom all key off the event energy.
// Foam renders as a wake-aware wash: the water body whitens smoothly and a
// spray cap rides above the waterline, churning on a coherent travelling
// phase - never per-cell randomness. Palette: deep teal -> turquoise -> mint.
// Calibrated in preview-seiche-lab.html (variant v15); thresholds measured
// from wall rise-rate distributions (P50 0.069 / max 0.395 per 2-unit step).
var QUOTA_TANK_SPEED = 2.25;
var QUOTA_TANK_EIGHTHS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
var QUOTA_TANK_PAL = [[0, "#06272b"], [0.53, "#28b5ad"], [1, "#a0f0e4"]];
var QUOTA_TANK_MODES = 12;
var QUOTA_TANK_W0 = 0.26;
var QUOTA_TANK_TSCALE = 0.5;
var QUOTA_TANK_GAIN = 0.6;
var QUOTA_TANK_FOAM_AT = 0.8;
var QUOTA_TANK_SPRAY = 0.12;
var QUOTA_TANK_LAG = 12;
var QUOTA_TANK_RISE_MIN = 0.11;
var QUOTA_TANK_RISE_MAX = 0.32;
var QUOTA_TANK_FOAM_FG = "#e8fffb";
var QUOTA_TANK_CAP_BASE = "#5fc8bd";
var QUOTA_TANK_CAP_TOP = "#ffffff";
function quotaTankScaleColor(hex, factor) {
  const ints = quotaColorInts(hex);
  if (!ints) return hex;
  const scaled = ints.map((value) => Math.max(0, Math.min(255, Math.round(value * factor))));
  return `#${scaled.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
function quotaTankGrade(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const a = stops[k - 1];
      const b = stops[k];
      const span = Math.max(1e-6, b[0] - a[0]);
      return quotaMixColor(a[1], b[1], (t - a[0]) / span);
    }
  }
  return stops[stops.length - 1][1];
}
function quotaTankSlotColor(bucket) {
  return quotaMixColor("#0a0a0a", bucket, 0.24);
}
function quotaTankCells(width, percent, bucket, phase) {
  const T = phase * QUOTA_TANK_SPEED;
  const filled = Math.round((percent / 100) * width);
  const W = Math.max(1, filled - 1);
  const N = QUOTA_TANK_MODES;
  const A = [];
  const P = [];
  const om = [];
  let sumsq = 0;
  for (let n = 1; n <= N; n++) {
    const w = n === 1 ? 1.7 : n === 2 ? 0.8 : n === 3 ? 0.45 : n === 4 ? 0.35 : n <= 8 ? 0.2 : 0.1;
    const a = w * (0.6 + 0.4 * quotaFireHash(n * 3.77));
    A.push(a);
    P.push(quotaFireHash(n * 9.13) * Math.PI * 2);
    om.push(QUOTA_TANK_W0 * Math.sqrt(n) * QUOTA_TANK_TSCALE);
    sumsq += a * a;
  }
  const norm = Math.max(1e-6, Math.sqrt(sumsq / 2));
  const ripples = (t, x) =>
    0.03 * Math.sin((x * 2.5 + t * 0.1) * Math.PI * 2) +
    0.02 * Math.sin((x * 4.5 - t * 0.14) * Math.PI * 2);
  const wallH = (t, side) => {
    let u = 0;
    for (let m = 0; m < N; m++) {
      const n = m + 1;
      const sp = side === 0 || n % 2 === 0 ? 1 : -1;
      u += A[m] * sp * Math.cos(om[m] * t + P[m]);
    }
    const uu = (u / norm) * QUOTA_TANK_GAIN;
    return quotaClamp(0.5 + (uu + 0.32 * uu * uu + ripples(t, side)) * 0.6, 0, 1);
  };
  const SCAN = 30;
  const STEPT = 2;
  const riseMin = QUOTA_TANK_RISE_MIN;
  const riseMax = QUOTA_TANK_RISE_MAX;
  const impactOf = (side) => {
    let best = 0;
    let bestAge = 0;
    let hPrev = wallH(T, side);
    for (let k = 0; k <= SCAN; k++) {
      const age = k * STEPT;
      const hNext = wallH(T - age - STEPT, side);
      const rise = hPrev - hNext;
      if (rise > best) {
        best = rise;
        bestAge = age;
      }
      hPrev = hNext;
    }
    return { mag: quotaClamp((best - riseMin) / (riseMax - riseMin), 0, 1), age: bestAge };
  };
  const impL = impactOf(0);
  const impR = impactOf(1);
  const trainPos = (age) => 0.4 + 0.22 * age - 0.0035 * age * age;
  const seed = Math.floor(T * 0.5);
  const cells = [];
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const x = i / W;
      let uA = 0;
      let uB = 0;
      for (let m = 0; m < N; m++) {
        const n = m + 1;
        const base = Math.cos(Math.PI * n * x);
        uA += A[m] * base * Math.cos(om[m] * T + P[m]);
        uB += A[m] * base * Math.cos(om[m] * (T - QUOTA_TANK_LAG) + P[m]);
      }
      const mk = (u) => {
        let v = u + 0.32 * u * u;
        v += ripples(T, x);
        return quotaClamp(0.5 + v * 0.6, 0, 1);
      };
      const h = mk((uA / norm) * QUOTA_TANK_GAIN);
      const hLag = mk((uB / norm) * QUOTA_TANK_GAIN);
      const dL = i;
      const dR = W - i;
      const xsL = trainPos(impL.age);
      const xsR = trainPos(impR.age);
      const gateL = quotaClamp((impL.mag - 0.2) / 0.5, 0, 1);
      const gateR = quotaClamp((impR.mag - 0.2) / 0.5, 0, 1);
      const sprayL = gateL * Math.exp(-impL.age / 16) * Math.exp(-((dL - xsL) * (dL - xsL)) / 2.42);
      const sprayR = gateR * Math.exp(-impR.age / 16) * Math.exp(-((dR - xsR) * (dR - xsR)) / 2.42);
      const run = 0.16 * (impL.mag * Math.exp(-impL.age / 14) * Math.exp(-dL / 1.8) + impR.mag * Math.exp(-impR.age / 14) * Math.exp(-dR / 1.8));
      const cling =
        0.05 *
        ((impL.age > 8 ? impL.mag * Math.exp(-(impL.age - 8) / 20) : 0) * Math.exp(-dL / 2.2) +
          (impR.age > 8 ? impR.mag * Math.exp(-(impR.age - 8) / 20) : 0) * Math.exp(-dR / 2.2));
      const foam = impL.mag * Math.exp(-impL.age / 20) * Math.exp(-dL / 1.5) + impR.mag * Math.exp(-impR.age / 20) * Math.exp(-dR / 1.5);
      const spray = sprayL + sprayR;
      const rip = spray * 0.05 * Math.sin(dL * 2.2 - T * 1.1);
      const jet = impL.mag * Math.exp(-impL.age / 2.6) * Math.exp(-dL / 1.1) + impR.mag * Math.exp(-impR.age / 2.6) * Math.exp(-dR / 1.1);
      // ---- water cell (exact lab copy; foam is wake-aware and coherent) ----
      const h2 = quotaClamp(h + run + cling + rip, 0, 1);
      const lvl = quotaClamp(Math.round(2 + h2 * 6), 2, 8);
      let fg = quotaTankGrade(QUOTA_TANK_PAL, h2);
      const foamAt = QUOTA_TANK_FOAM_AT - 0.22 * foam;
      const foamH = Math.max(h2, hLag * 0.96 + foam * 0.25);
      const foamI = quotaClamp((foamH - foamAt) / 0.16, 0, 1) * quotaClamp(h2 * 1.6, 0.3, 1);
      if (foamI < 0.05 && jet < 0.3 && spray < 0.3) {
        cells.push({ g: QUOTA_TANK_EIGHTHS[lvl - 1], fg });
        continue;
      }
      const churn = Math.sin(T * 1.25 + i * 0.5) * 0.5 + Math.sin(T * 2.1 - i * 0.9) * 0.25;
      fg = quotaMixColor(fg, QUOTA_TANK_FOAM_FG, quotaClamp(foamI * 0.95 + churn * 0.1 + spray * 0.3, 0, 1) * 0.85);
      const cell = { g: QUOTA_TANK_EIGHTHS[lvl - 1], fg };
      const cap = quotaClamp(foamI * 1.15 + churn * 0.25 + spray * 0.75 + jet * 1.25, 0, 1) * quotaClamp((h2 - 0.3) / 0.5, 0, 1);
      if (cap > 0.04) {
        let bg = quotaMixColor(QUOTA_TANK_CAP_BASE, QUOTA_TANK_CAP_TOP, Math.pow(cap, 0.7));
        const popChance = Math.min(0.85, QUOTA_TANK_SPRAY * 0.5 + jet * 0.4 + spray * 0.25);
        if (cap > 0.68 && popChance > 0 && quotaFireHash(i * 5.3 + seed * 7.9) > 1 - popChance) bg = "#ffffff";
        else if (QUOTA_TANK_SPRAY > 0 && cap > 0.8 && churn > 0.58) bg = "#ffffff";
        cell.bg = bg;
      }
      cells.push(cell);
    } else {
      cells.push({ g: "\u2581", fg: quotaTankSlotColor(bucket) });
    }
  }
  return cells;
}
function quotaWaterBarSegments(width, percent, mode, phase, theme) {
  const pctRaw = Number(percent);
  const pct = Number.isFinite(pctRaw) ? quotaClamp(pctRaw, 0, 100) : 0;
  const text = theme && theme.text ? theme.text : {};
  const bucket = quotaBarBucketColor(pct, mode, theme) || (text && text.muted) || "#888888";
  const segments = [];
  for (const cell of quotaTankCells(width, pct, bucket, phase)) {
    if (cell.bg !== undefined) {
      segments.push({ text: cell.g, fg: cell.fg, bg: cell.bg });
    } else {
      segments.push({ text: cell.g, fg: cell.fg });
    }
  }
  const label = `${Math.round(pct)}% ${mode === "used" ? "used" : "left"}`.padStart(9);
  const parts = label.match(/^(\s*)(\d+%)(\s.*)?$/u);
  segments.push({ text: "  ", fg: text.muted });
  if (parts) {
    if (parts[1]) segments.push({ text: parts[1], fg: text.muted });
    segments.push({ text: parts[2], fg: bucket });
    if (parts[3]) segments.push({ text: parts[3], fg: text.muted });
  } else {
    segments.push({ text: label, fg: text.muted });
  }
  return segments;
}

function quotaSidebarLineElement(line, props) {
  if (line.startsWith("[")) {
    var _el$head = _$createElement("text");
    var _el$headBold = _$createElement("b");
    _$insertNode(_el$head, _el$headBold);
    _$setProp(_el$head, "wrapMode", "none");
    _$insert(_el$headBold, line);
    _$effect(_$p => _$setProp(_el$head, "fg", props.context.theme.text.base, _$p));
    return _el$head;
  }
  if (quotaFireTokenCountsLine(line)) {
    startQuotaFxClock();
    var _el$burn = _$createElement("text");
    _$setProp(_el$burn, "wrapMode", "none");
    for (const segment of quotaTokenFireSegments(line)) {
      const _el$burnSpan = _$createElement("span");
      _$insert(_el$burnSpan, segment.text);
      if (segment.burn) {
        _$effect(_$p => _$setProp(_el$burnSpan, "style", { fg: quotaTokenFireColor(segment.index, quotaFxPhase(), segment.seed) }, _$p));
      } else {
        _$effect(_$p => _$setProp(_el$burnSpan, "style", { fg: props.context.theme.text.muted }, _$p));
      }
      _$insertNode(_el$burn, _el$burnSpan);
    }
    return _el$burn;
  }
  var _el$body = _$createElement("text");
  _$setProp(_el$body, "wrapMode", "none");
  for (const segment of quotaSidebarLineSegments(line)) {
    const _el$bodySpan = _$createElement("span");
    _$insert(_el$bodySpan, segment.text);
    _$effect(_$p => _$setProp(_el$bodySpan, "style", { fg: segment.color(props.context.theme) }, _$p));
    _$insertNode(_el$body, _el$bodySpan);
  }
  return _el$body;
}
function QuotaBarVisual(props) {
  startQuotaFxClock();
  const match = QUOTA_BAR_RE.exec(props.line);
  const filled = match ? match[1].length : 0;
  const empty = match && match[2] ? match[2].length : 0;
  const percent = match ? Number(match[3]) : 0;
  const mode = match && match[4] ? match[4] : "left";
  const width = Math.max(1, filled + empty);
  // Classic one-row bar: 21 water cells + two spaces + the 9-char percent label.
  // The window name row above the bar renders as a normal colored row again.
  return (() => {
    var _el$waterBar = _$createElement("text");
    _$setProp(_el$waterBar, "wrapMode", "none");
    _$insert(_el$waterBar, () =>
      quotaWaterBarSegments(width, percent, mode, quotaFxPhase(), props.context.theme).map((segment) => {
        const _el$cell = _$createElement("span");
        _$insert(_el$cell, segment.text);
        if (segment.bg !== undefined) {
          _$setProp(_el$cell, "style", { fg: segment.fg, bg: segment.bg });
        } else if (segment.fg !== undefined) {
          _$setProp(_el$cell, "style", { fg: segment.fg });
        }
        return _el$cell;
      })
    );
    return _el$waterBar;
  })();
}
function quotaSidebarBodyElements(props, lines) {
  const nodes = [];
  let barIndex = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Pure separator rows are dropped (an empty line carries no content).
    if (line === "") continue;
    if (quotaBarLine(line)) {
      nodes.push(_$createComponent(QuotaBarVisual, { barKey: barIndex, line, context: props.context }));
      barIndex += 1;
      continue;
    }
    nodes.push(quotaSidebarLineElement(line, props));
  }
  return nodes;
}
// __quotaFirePatchEnd__
