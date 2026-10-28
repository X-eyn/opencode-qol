// Quota Lab — our own quota visualization plugin.
//
// Data: the @slkiser/opencode-quota server plugin exposes an RPC
// (id "slkiser.opencode-quota", method "surface") returning { quota: { message, ... } }.
// We call it, parse the formatted panel message, and render our own visuals:
//   - sidebar section  (append "sidebar.content")
//   - Lab panel        (append "session.panel", opened via the "Open Quota Lab" command)
// The water bars come from ./water (exact-solution seiche with splash physics).
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Rpc } from "@opencode/plugin/rpc"
import { ErrorBoundary, Index, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { readFileSync, writeFileSync } from "node:fs"
import { PixelBar } from "./pixelbar"
import { STYLES, currentStyle, setStyle } from "./styles"
import { BAR_CELLS, tankBarRows, tankCells, tankPixelCells, tankScene, tankStrip } from "./water"

// ---- quota RPC (client-side definition; the server validates for real) ----
const QuotaRpc = Rpc.define({
  id: "slkiser.opencode-quota",
  methods: {
    surface: {
      input: {
        type: "object",
        properties: { surface: { type: "string" }, sessionID: { type: "string" } },
        required: ["surface", "sessionID"],
        additionalProperties: false,
      },
      output: { type: ["object", "null"], additionalProperties: true },
    },
  },
})

// ---- shared 120ms animation clock (same cadence as the terminal UI) ----
// The timer handle lives on globalThis so a plugin reload (which re-imports
// this module) clears the previous instance's timer instead of stacking a new
// one on top (each reload used to leak a 120ms timer driving a dead module).
const [phase, setPhase] = createSignal(0)
function startClock() {
  const g = globalThis as any
  if (g.__quotaLabClock?.set === setPhase) return
  if (g.__quotaLabClock) clearInterval(g.__quotaLabClock.timer)
  g.__quotaLabClock = { set: setPhase, timer: setInterval(() => setPhase((p) => (p + 1) % 100000), 120) }
}
function stopClock() {
  const g = globalThis as any
  if (g.__quotaLabClock?.set !== setPhase) return
  clearInterval(g.__quotaLabClock.timer)
  g.__quotaLabClock = undefined
}

// ---- parsing the quota panel message ----
type Row =
  | { kind: "bar"; pct: number; mode: string }
  | { kind: "name"; name: string; time: string }
  | { kind: "header"; text: string }
  | { kind: "plain"; text: string }

const BAR_RE = /^([█]+)([░]*)\s+(\d+)%\s*(left|used)?\s*$/u
const NAME_TIME_RE = /^(.*?)(\s{2,})((?:\d+(?:\.\d+)?[dhms]\s*)+)\s*$/u

function parsePanel(msg: string | null): Row[] {
  if (!msg) return []
  const rows: Row[] = []
  for (const line of msg.split("\n")) {
    if (!line.trim()) continue
    const bar = BAR_RE.exec(line)
    if (bar) {
      rows.push({ kind: "bar", pct: Number(bar[3]), mode: bar[4] ?? "left" })
      continue
    }
    const nt = NAME_TIME_RE.exec(line)
    if (nt) {
      rows.push({ kind: "name", name: nt[1], time: nt[3].trimEnd() })
      continue
    }
    if (line.startsWith("[") || line.includes("Quota")) rows.push({ kind: "header", text: line })
    else rows.push({ kind: "plain", text: line })
  }
  return rows
}

// ---- classic name/countdown alignment (32-col content, like the formatter) ----
function nameTimeLine(name: string, time: string, maxWidth = 32) {
  const sep = "  "
  let timeWidth = Math.max(time.length, 7)
  const preferredNameWidth = maxWidth - sep.length - timeWidth
  if (name.length > preferredNameWidth && name.length + sep.length + time.length <= maxWidth) timeWidth = time.length
  const nameWidth = Math.max(1, maxWidth - sep.length - timeWidth)
  return { name: name.slice(0, nameWidth).padEnd(nameWidth), sep, time: time.padStart(timeWidth) }
}

// ---- theme colors are objects (toInts()/r,g,b), not hex; normalize for the engine ----
function intsToHexLocal(ints: number[]): string {
  return `#${ints
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")}`
}
let bgRecorded = ""
function recordBg(hex: string, surfaces: any = {}) {
  if (bgRecorded === hex) return
  bgRecorded = hex
  // diagnostics: every background surface the theme offers, resolved
  const all: Record<string, string> = {}
  try {
    for (const k of Object.keys(surfaces ?? {})) all[k] = themeHex(surfaces[k], "?")
  } catch {}
  try {
    const url = new URL("../../quota-lab.json", import.meta.url)
    let state: Record<string, unknown> = {}
    try {
      state = JSON.parse(readFileSync(url, "utf8")) ?? {}
    } catch {}
    writeFileSync(url, JSON.stringify({ ...state, themeBackground: hex, themeSurfaces: all }, null, 2) + String.fromCharCode(10))
  } catch {}
}
function themeHex(value: any, fallback: string): string {
  if (typeof value === "string") {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim() : fallback
  }
  if (value && typeof value === "object") {
    if (typeof value.toInts === "function") {
      try {
        const ints = value.toInts()
        if (Array.isArray(ints) && ints.length >= 3) return intsToHexLocal([ints[0], ints[1], ints[2]])
      } catch {}
    }
    const r = value.r
    const g = value.g
    const b = value.b
    if ([r, g, b].every((n: any) => typeof n === "number" && Number.isFinite(n))) {
      const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1
      return intsToHexLocal([r * scale, g * scale, b * scale])
    }
    if (typeof value.hex === "string") return value.hex
    if (value.base !== undefined) return themeHex(value.base, fallback)
  }
  return fallback
}
function tierColor(theme: any, pct: number, mode: string): string {
  const remaining = mode === "used" ? 100 - pct : pct
  const f = theme?.text?.feedback ?? {}
  const pick = remaining < 30 ? f.error : remaining < 70 ? f.warning : f.success
  return themeHex(pick?.base, themeHex(theme?.text?.muted, "#888888"))
}

// ---- burning token numbers (ported 1:1 from the validated patch) ----
const BURN_PALETTE = ["#6E1400", "#A31D00", "#D93600", "#FF5A00", "#FF8A00", "#FFB733", "#FFE594"]
const BURN_BAYER = [
  [0, 2],
  [3, 1],
]
const COUNTS_RE = /\b\d[\d.]*[KMB]?\)?\s+(?:in|out)\b/u
function burnHash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
function burnColor(index: number, phaseValue: number, seed: number): string {
  const t = phaseValue * 0.5
  const heat =
    0.84 +
    0.15 * Math.sin(index * 0.7 + t * 1.3 + seed) +
    0.11 * Math.sin(index * 0.27 - t * 0.9 + seed * 2.3) +
    0.07 * (burnHash(index * 11.7 + Math.floor(t) * 3.1 + seed * 7.9) - 0.5)
  const dithered = heat + (BURN_BAYER[index & 1][(index + Math.floor(phaseValue / 2)) & 1] / 4 - 0.375) * 0.3
  const clamped = Math.max(0.01, Math.min(0.999, dithered))
  return BURN_PALETTE[Math.floor(clamped * BURN_PALETTE.length)]
}
function burnMask(chars: string[]): boolean[] {
  const burn = new Array(chars.length).fill(false)
  let runStart = -1
  let runHasDigit = false
  for (let i = 0; i <= chars.length; i++) {
    const isNumChar = i < chars.length && /[0-9KMB.()]/u.test(chars[i])
    if (isNumChar) {
      if (runStart < 0) {
        runStart = i
        runHasDigit = false
      }
      if (/[0-9]/u.test(chars[i])) runHasDigit = true
    } else if (runStart >= 0) {
      if (runHasDigit) for (let j = runStart; j < i; j++) burn[j] = true
      runStart = -1
    }
  }
  return burn
}

// ---- quota message hook (shared by the sidebar section and the lab panel) ----
function useQuotaMessage(sessionID: () => string) {
  const context = usePlugin()
  const [message, setMessage] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<string>("initializing")
  const [detail, setDetail] = createSignal<string>("")
  onMount(() => {
    let alive = true
    const client = context.client.rpc(QuotaRpc)
    const refresh = async () => {
      const sid = sessionID()
      if (!sid) {
        setStatus("no-session")
        setDetail(String(sid))
        return
      }
      try {
        const res: any = await client.surface({ surface: "sidebar", sessionID: sid })
        if (!alive) return
        const data = res && typeof res === "object" && "data" in res ? res.data : res
        const q = data?.quota
        const msg = typeof q === "string" ? q : q?.message
        if (typeof msg === "string" && msg.length > 0) {
          setMessage(msg)
          setStatus("ok")
          setDetail("")
          const g = globalThis as any
          if (!g.__quotaLabLiveToasted) {
            g.__quotaLabLiveToasted = true
            try {
              context.ui.toast.show({ message: "Quota Lab: live", variant: "success", duration: 2000 })
            } catch {}
          }
        } else {
          setMessage(null)
          setStatus("empty")
          const keys = q && typeof q === "object" ? `quota {${JSON.stringify(Object.keys(q)).slice(0, 60)}}` : typeof q
          setDetail(`keys ${keys}`)
        }
      } catch (error) {
        if (!alive) return
        setMessage(null)
        setStatus("rpc-error")
        setDetail(error instanceof Error ? error.message : String(error))
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    onCleanup(() => {
      alive = false
      clearInterval(timer)
    })
  })
  return { message, status, detail }
}

// ---- components ----
// The classic bar: one row, 21 cells + label, eighth-block water. The exact
// height/width of the original design (kept as the default until the render
// strategy is chosen).
function ClassicBar(props: { pct: number; mode: string; width?: number }) {
  const context = usePlugin()
  const bucket = createMemo(() => tierColor(context.theme, props.pct, props.mode))
  const spans = createMemo(() => {
    const out: any[] = []
    for (const cell of tankCells(props.width ?? BAR_CELLS, props.pct, bucket(), phase())) {
      out.push(cell.bg !== undefined ? <span style={{ fg: cell.fg, bg: cell.bg }}>{cell.g}</span> : <span style={{ fg: cell.fg }}>{cell.g}</span>)
    }
    const raw = `${Math.round(props.pct)}% ${props.mode === "used" ? "used" : "left"}`.padStart(9)
    const m = /^(\s*)(\d+%)(\s.*)?$/u.exec(raw)
    const label = m ? { pre: m[1] ?? "", num: m[2], post: m[3] ?? "" } : { pre: "", num: raw, post: "" }
    out.push(<span style={{ fg: context.theme.text.muted }}>{"  " + label.pre}</span>)
    out.push(<span style={{ fg: bucket() }}>{label.num}</span>)
    out.push(<span style={{ fg: context.theme.text.muted }}>{label.post}</span>)
    return out
  })
  return <text wrapMode="none">{spans()}</text>
}

// The bar: exact classic footprint (21 cells + label), rendered as a braille
// pixel canvas — 2x4 addressable pixels per cell (42x4 bitmap), painted dot
// by dot from the physics engine.
function BraillePixelBar(props: { pct: number; mode: string; width?: number }) {
  const context = usePlugin()
  const bucket = createMemo(() => tierColor(context.theme, props.pct, props.mode))
  const spans = createMemo(() => {
    const out: any[] = []
    for (const cell of tankPixelCells(props.width ?? BAR_CELLS, props.pct, phase(), bucket())) {
      out.push(<span style={{ fg: cell.fg }}>{cell.g}</span>)
    }
    const raw = `${Math.round(props.pct)}% ${props.mode === "used" ? "used" : "left"}`.padStart(9)
    const m = /^(\s*)(\d+%)(\s.*)?$/u.exec(raw)
    const label = m ? { pre: m[1] ?? "", num: m[2], post: m[3] ?? "" } : { pre: "", num: raw, post: "" }
    out.push(<span style={{ fg: context.theme.text.muted }}>{"  " + label.pre}</span>)
    out.push(<span style={{ fg: bucket() }}>{label.num}</span>)
    out.push(<span style={{ fg: context.theme.text.muted }}>{label.post}</span>)
    return out
  })
  return <text wrapMode="none">{spans()}</text>
}

function BarBlock(props: { pct: number; mode: string; width?: number; rows?: number }) {
  const context = usePlugin()
  const rws = Math.max(1, props.rows ?? 3)
  const mid = Math.floor(rws / 2)
  const bucket = createMemo(() => tierColor(context.theme, props.pct, props.mode))
  const grid = createMemo(() => tankBarRows(props.width ?? BAR_CELLS, rws, props.pct, phase(), bucket()))
  const label = createMemo(() => {
    const raw = `${Math.round(props.pct)}% ${props.mode === "used" ? "used" : "left"}`.padStart(9)
    const m = /^(\s*)(\d+%)(\s.*)?$/u.exec(raw)
    return m ? { pre: m[1] ?? "", num: m[2], post: m[3] ?? "" } : { pre: "", num: raw, post: "" }
  })
  // Static row shells; the reactive binding lives INSIDE each row so the block
  // re-renders every clock tick (returning a finished array from the component
  // body would only evaluate once and freeze the animation).
  return Array.from({ length: rws }, (_, r) => (
    <text wrapMode="none">
      {(() => {
        const rowCells = grid()[r] ?? []
        const spans: any[] = []
        for (const cell of rowCells) {
          if (cell.bg !== undefined) spans.push(<span style={{ fg: cell.fg, bg: cell.bg }}>{cell.g}</span>)
          else if (cell.fg !== undefined) spans.push(<span style={{ fg: cell.fg }}>{cell.g}</span>)
          else spans.push(<span>{cell.g}</span>)
        }
        if (r === mid) {
          spans.push(<span style={{ fg: context.theme.text.muted }}>{"  " + label().pre}</span>)
          spans.push(<span style={{ fg: bucket() }}>{label().num}</span>)
          spans.push(<span style={{ fg: context.theme.text.muted }}>{label().post}</span>)
        }
        return spans
      })()}
    </text>
  ))
}

function NameLine(props: { name: string; time: string; width?: number }) {
  const context = usePlugin()
  const parts = createMemo(() => nameTimeLine(props.name, props.time, props.width ?? 32))
  return (
    <text wrapMode="none">
      <span style={{ fg: context.theme.text.muted }}>{parts().name + parts().sep}</span>
      <span style={{ fg: context.theme.text.action?.primary?.selected ?? context.theme.text.muted }}>{parts().time}</span>
    </text>
  )
}

function CountsLine(props: { text: string }) {
  const context = usePlugin()
  const spans = createMemo(() => {
    const chars = Array.from(props.text)
    const mask = burnMask(chars)
    const splitIndex = props.text.indexOf(" in")
    const ph = phase()
    const out: any[] = []
    for (let i = 0; i < chars.length; i++) {
      if (mask[i]) {
        const seed = splitIndex >= 0 && i > splitIndex ? 9 : 3
        out.push(<span style={{ fg: burnColor(i, ph, seed) }}>{chars[i]}</span>)
      } else {
        out.push(<span style={{ fg: context.theme.text.muted }}>{chars[i]}</span>)
      }
    }
    return out
  })
  return <text wrapMode="none">{spans()}</text>
}

function rowView(row: Row, context: any, width?: number) {
  if (row.kind === "bar") return <ClassicBar pct={row.pct} mode={row.mode} />
  if (row.kind === "name") return <NameLine name={row.name} time={row.time} width={width} />
  if (row.kind === "plain" && COUNTS_RE.test(row.text)) return <CountsLine text={row.text} />
  return (
    <text wrapMode="none">
      <span style={{ fg: row.kind === "header" ? context.theme.text.base : context.theme.text.muted }}>{row.text}</span>
    </text>
  )
}

const SIDEBAR_SCENE_ROWS = 8

// Lane B: one quota-bar row as a micro shoreline. Same tide semantics as the
// big scene (water extent = this window's pct) in the exact 1-row footprint.
function Strip(props: { cols: number; percent: number }) {
  const context = usePlugin()
  const cells = createMemo(() => tankStrip(props.cols, props.percent, phase()))
  return (
    <text wrapMode="none">
      {cells().map((cell) =>
        cell.bg !== undefined ? (
          <span style={{ fg: cell.fg, bg: cell.bg }}>{cell.g}</span>
        ) : cell.fg !== undefined ? (
          <span style={{ fg: cell.fg }}>{cell.g}</span>
        ) : (
          <span>{cell.g}</span>
        )
      )}
    </text>
  )
}

// Window label row: two clearly separate groups.
//   left  - WHAT: the window and how much of it is left   "5-hour   99%"
//   right - WHEN: when it resets                           "resets in  3h 39m"
// A wide gap keeps them from reading as one phrase; filler words are dim so
// the eye lands on the numbers. The countdown ends exactly where the bar under
// it ends and is padded to one width, so every column lines up down the card.
// Too narrow -> "resets in" shortens to "resets", then to "↻"; never cut.
function dimText(context: any): string {
  // a step quieter than muted text, for filler words and column labels
  const t = context.theme?.text ?? {}
  return themeHex(t.subtle ?? t.disabled ?? t.placeholder, "#5c5c5c")
}
function WindowName(props: { label: string; pct: number; mode: string; time: string; width: number; labelWidth: number }) {
  const context = usePlugin()
  const action = context.theme.text.action?.primary?.selected ?? context.theme.text.muted
  const dim = dimText(context)
  // strings only: the text nodes below are created once and updated in place
  const parts = createMemo(() => {
    const name = props.label.padEnd(props.labelWidth) + "  "
    const pct = `${props.pct}%`.padStart(4)
    const time = props.time ? props.time.padStart(7) : ""
    const left = name.length + pct.length
    let tag = ""
    if (time) {
      for (const cand of ["resets in ", "resets ", "↻ "]) {
        if (left + 3 + cand.length + time.length <= props.width) {
          tag = cand
          break
        }
      }
      if (!tag) tag = "↻ "
    }
    const gap = " ".repeat(Math.max(2, props.width - (left + tag.length + time.length)))
    return { name, pct, gap, tag, time }
  })
  return (
    <text wrapMode="none">
      <span style={{ fg: context.theme.text.base }}>{parts().name}</span>
      <span style={{ fg: tierColor(context.theme, props.pct, props.mode) }}>{parts().pct}</span>
      <span>{parts().gap}</span>
      <span style={{ fg: dim }}>{parts().tag}</span>
      <span style={{ fg: action }}>{parts().time}</span>
    </text>
  )
}

// Session tokens as a small table: model | in | out, numbers right-aligned
// under their headers (and burning, as before); the cached-input count sits
// on its own dim line under the model.
type TokenRow = { model: string; input: string; cached: string; output: string }
const TOKEN_COUNTS_RE = /^\s*([\d.]+[KMB]?)(?:\s*\(([\d.]+[KMB]?)\))?\s+in(?:\s+([\d.]+[KMB]?)\s+out)?\s*$/u
const TOKEN_OUT_RE = /^\s*([\d.]+[KMB]?)\s+out\s*$/u
function BurnText(props: { text: string; seed: number }) {
  const chars = createMemo(() => Array.from(props.text))
  return (
    <Index each={chars()}>
      {(ch, i) => <span style={{ fg: ch() === " " ? undefined : burnColor(i + props.seed * 3, phase(), props.seed) }}>{ch()}</span>}
    </Index>
  )
}
function TokenRowView(props: { r: () => TokenRow; k: number; modelW: () => number }) {
  const context = usePlugin()
  const fit = (t: string, w: number) => (t.length <= w ? t.padEnd(w) : t.slice(0, w - 1) + "…")
  return [
    <text wrapMode="none">
      <span style={{ fg: context.theme.text.muted }}>{fit(props.r().model, props.modelW())}</span>
      <BurnText text={props.r().input.padStart(7)} seed={3 + props.k} />
      <span>{"  "}</span>
      <BurnText text={props.r().output.padStart(6)} seed={9 + props.k} />
    </text>,
    <Show when={props.r().cached}>
      <text wrapMode="none">
        <span style={{ fg: dimText(context) }}>{"  cached " + props.r().cached}</span>
      </text>
    </Show>,
  ]
}
function TokensBlock(props: { rows: TokenRow[]; width: number }) {
  const context = usePlugin()
  const modelW = createMemo(() => Math.max(8, props.width - 7 - 2 - 6))
  const fit = (t: string, w: number) => (t.length <= w ? t.padEnd(w) : t.slice(0, w - 1) + "…")
  return [
    <text wrapMode="none">
      <span style={{ fg: context.theme.text.base }}>{fit("Session tokens", modelW())}</span>
      <span style={{ fg: dimText(context) }}>{"in".padStart(7) + "  " + "out".padStart(6)}</span>
    </text>,
    <Index each={props.rows}>{(r, k) => <TokenRowView r={r} k={k} modelW={modelW} />}</Index>,
  ]
}

// "21d10h" or "21d 10h" -> "21d 10h": always a space between units
function spacedTime(t: string): string {
  return t.replace(/(\d+(?:\.\d+)?[dhms])(?=\d)/g, "$1 ").replace(/\s+/g, " ").trim()
}

// friendly window names for the formatter's short labels
function windowName(raw: string): string {
  const t = raw.trim()
  if (/^5h$/i.test(t)) return "5-hour"
  if (/^(w|weekly|7d)$/i.test(t)) return "Weekly"
  if (/^(m|monthly|30d)$/i.test(t)) return "Monthly"
  if (/^(d|daily|24h|1d)$/i.test(t)) return "Daily"
  return t.length > 9 ? t.slice(0, 9) : t
}

// Any other formatter row (provider header, notices): one text node,
// content updated in place
function PlainRow(props: { row: () => Row; width: () => number }) {
  const context = usePlugin()
  const txt = createMemo(() => {
    const r = props.row()
    if (!r) return ""
    if (r.kind === "name") {
      const p = nameTimeLine(r.name, r.time, props.width())
      return p.name + p.sep + p.time
    }
    if (r.kind === "bar") return ""
    return r.text
  })
  const col = createMemo(() => (props.row()?.kind === "header" ? context.theme.text.base : context.theme.text.muted))
  return (
    <text wrapMode="none">
      <span style={{ fg: col() }}>{txt()}</span>
    </text>
  )
}

type CardBlockData =
  | { kind: "bar"; label: string; pct: number; rawPct: number; mode: string; time: string; seed: number }
  | { kind: "tokens"; rows: TokenRow[] }
  | { kind: "row"; row: Row }

// One card block at a fixed position. Text parts re-render freely (cheap);
// the image bar inside a "bar" block is created once and only fed new props.
function CardBlock(props: { b: () => CardBlockData; labelWidth: () => number; cols: () => number; bg: () => string }) {
  const context = usePlugin()
  const kind = createMemo(() => props.b().kind)
  const bar = () => props.b() as Extract<CardBlockData, { kind: "bar" }>
  return (
    <Switch>
      <Match when={kind() === "bar"}>
        <box flexDirection="column">
          <WindowName
            label={bar().label}
            pct={bar().pct}
            mode={bar().mode}
            time={bar().time}
            width={props.cols()}
            labelWidth={props.labelWidth()}
          />
          <Show when={currentStyle().kind === "pixel"} fallback={<Strip cols={props.cols()} percent={bar().rawPct} />}>
            <PixelBar
              id={`${bar().label}#${bar().seed}`}
              seed={bar().seed}
              cols={props.cols()}
              percent={bar().rawPct}
              styleId={currentStyle().id}
              create={(currentStyle() as any).create}
              bg={props.bg()}
              fallback={() => <Strip cols={props.cols()} percent={bar().rawPct} />}
            />
          </Show>
        </box>
      </Match>
      <Match when={kind() === "tokens"}>
        <TokensBlock rows={(props.b() as any).rows ?? []} width={props.cols()} />
      </Match>
      <Match when={kind() === "row"}>
        <PlainRow row={() => (props.b() as any).row} width={props.cols} />
      </Match>
    </Switch>
  )
}

// Sidebar quota: the CLASSIC card, row for row — every upstream row renders as
// before (name rows, token counts, engine line), except each 1-row bar becomes
// a 1-row shoreline strip carrying that window's tide. Same region, same rows,
// no info lost: name, pct, countdown and counts all stay on screen.
function QuotaSection(props: { sessionID: string; width?: number }) {
  const context = usePlugin()
  startClock()
  const { message, status, detail } = useQuotaMessage(() => props.sessionID)
  const rows = createMemo(() => parsePanel(message()))
  const statusLine = createMemo(() => {
    const d = detail()
    return `[quota-lab] ${status()}${d ? " · " + d : ""}`.slice(0, 64)
  })
  // The card's real interior width, measured from layout (box width minus the
  // 2 border cells and 2 padding cells). Guessing it from props.width came out
  // 7 cells too wide: text strips were silently clipped at the border (cutting
  // off the beach), and a Sixel image, which is never clipped, spilled out.
  let card: any
  const [inner, setInner] = createSignal(0)
  createEffect(() => {
    phase()
    const w = card?.width
    if (typeof w === "number" && w > 4 && w - 4 !== inner()) setInner(w - 4)
  })
  const contentCols = () => {
    if (inner() > 0) return inner()
    // before the first layout pass: conservative guess
    const w = (props as any)?.width
    const x = typeof w === "function" ? w() : w
    const base = typeof x === "number" && x > 0 ? x : 56
    return Math.max(20, Math.min(33, base - 20))
  }
  // Label/time pairing follows the formatter's OWN line order: every bar line is
  // preceded by its window label line. A window at 100% emits NO countdown, so
  // its label line is a bare name ("5h") — a positional names[]/bars[] zip would
  // silently shift every label after the first untimed window. The label row's
  // index is recorded so the render pass can suppress it (otherwise every
  // label shows twice: once from upstream, once from WindowName).
  const windows = createMemo(() => {
    const list = rows()
    const out: { label: string; pct: number; mode: string; time: string; labelIndex: number }[] = []
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (r.kind !== "bar") continue
      let j = i - 1
      while (j >= 0 && list[j].kind === "bar") j--
      const prev = j >= 0 ? list[j] : undefined
      let label = ""
      let time = ""
      let labelIndex = -1
      if (prev) {
        if (prev.kind === "name") {
          label = prev.name.trim()
          time = prev.time.split(/\s+/).slice(0, 2).join(" ")
          labelIndex = j
        } else {
          const text = prev.text.trim()
          const nt = NAME_TIME_RE.exec(text)
          if (nt) {
            label = nt[1].trim()
            time = nt[3].split(/\s+/).slice(0, 2).join(" ")
            labelIndex = j
          } else if (!text.includes(":") && !text.startsWith("[") && text.length <= 24) {
            // bare name line ("5h"); lines with colons are data (basis/model),
            // never labels
            label = text
            labelIndex = j
          }
        }
      }
      if (!label || label.startsWith("[")) {
        label = ""
        labelIndex = -1
      }
      const fallback = ["5h", "Weekly", "Monthly"][out.length] ?? "?"
      const raw = (label || fallback).trim()
      out.push({ label: windowName(raw), pct: Math.round(r.pct), mode: r.mode, time: spacedTime(time), labelIndex })
    }
    return out
  })
  // the card's background, so empty-backdrop scenes (the lightsaber) blend
  // into it (the sidebar paints the raised surface, not the base background)
  const cardBg = createMemo(() => {
    const bgT = context.theme?.background ?? {}
    const hex = themeHex(bgT.raised ?? bgT.panel ?? bgT.base, "#141414")
    recordBg(hex, bgT)
    return hex
  })
  // the card's blocks in order: bars (with their label row), the token table,
  // and every other formatter row as plain text
  const layout = createMemo(() => {
    const list = rows()
    const wins = windows()
    const consumed = new Set(wins.map((w) => w.labelIndex))
    const labelWidth = Math.max(1, ...wins.map((w) => w.label.length))
    const tokIdx = list.findIndex((r) => (r.kind === "plain" || r.kind === "header") && /^session input\/output tokens$/i.test(r.text.trim()))
    const tokRows: TokenRow[] = []
    if (tokIdx >= 0) {
      consumed.add(tokIdx)
      let cur: TokenRow | null = null
      for (let k = tokIdx + 1; k < list.length; k++) {
        const r = list[k]
        if (r.kind !== "plain") break
        const m = TOKEN_COUNTS_RE.exec(r.text)
        const mo = TOKEN_OUT_RE.exec(r.text)
        if (m && cur) {
          cur.input = m[1]
          cur.cached = m[2] ?? ""
          if (m[3]) cur.output = m[3]
        } else if (mo && cur) cur.output = mo[1]
        else {
          cur = { model: r.text.trim(), input: "", cached: "", output: "" }
          tokRows.push(cur)
        }
        consumed.add(k)
      }
    }
    const blocks: CardBlockData[] = []
    let bi = 0
    list.forEach((row, ri) => {
      if (ri === tokIdx) {
        blocks.push({ kind: "tokens", rows: tokRows })
        return
      }
      if (consumed.has(ri)) return
      if (row.kind === "bar") {
        const w = wins[bi++] ?? { label: "?", pct: row.pct, mode: row.mode, time: "" }
        blocks.push({ kind: "bar", label: w.label, pct: w.pct, rawPct: row.pct, mode: w.mode, time: w.time, seed: bi })
        return
      }
      blocks.push({ kind: "row", row })
    })
    return { blocks, labelWidth }
  })
  return (
    <ErrorBoundary
      fallback={(err: any) => (
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.muted }}>
            {`[quota-lab] render-error · ${String(err?.message ?? err).slice(0, 56)}`}
          </span>
        </text>
      )}
    >
      <box
        ref={(r: any) => (card = r)}
        border
        borderStyle="rounded"
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        borderColor={themeHex(context.theme?.border?.base, "#EC5B2B")}
      >
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.base }}>{"▼ Quota"}</span>
        </text>
        <Show
          when={rows().length > 0}
          fallback={
            <text wrapMode="none">
              <span style={{ fg: context.theme.text.muted }}>{statusLine()}</span>
            </text>
          }
        >
          {/* Stable, index-keyed tree: each row/bar is created ONCE per position
              and receives new data through reactive props. Rebuilding the list
              on every quota refresh recreated the image bars, and each one was
              blank until its next frame - that was the blink. */}
          <Index each={layout().blocks}>
            {(b) => <CardBlock b={b} labelWidth={() => layout().labelWidth} cols={contentCols} bg={cardBg} />}
          </Index>
        </Show>
      </box>
    </ErrorBoundary>
  )
}

const SCENE_ROWS = 12

// Seaside scene: the tide line IS the quota; the seiche drives the waves; the
// shore carries real swash physics; procedural dot-matrix palms stand on the
// dunes. Composed as braille masks over two-color fields (lane A: the panel
// is the art canvas).
function SceneView(props: { width: number; percent: number; rows?: number }) {
  const context = usePlugin()
  const rws = () => props.rows ?? SCENE_ROWS
  const scene = createMemo(() => tankScene(props.width, rws(), props.percent, phase()))
  return Array.from({ length: rws() }, (_, r) => (
    <text wrapMode="none">
      {(() => {
        const rowCells = scene()[r] ?? []
        const spans: any[] = []
        for (const cell of rowCells) {
          if (cell.g === " " && cell.bg !== undefined) spans.push(<span style={{ bg: cell.bg }}>{" "}</span>)
          else if (cell.bg !== undefined) spans.push(<span style={{ fg: cell.fg, bg: cell.bg }}>{cell.g}</span>)
          else if (cell.fg !== undefined) spans.push(<span style={{ fg: cell.fg }}>{cell.g}</span>)
          else spans.push(<span>{cell.g}</span>)
        }
        return spans
      })()}
    </text>
  ))
}

function LabPanel(props: { panel: any }) {
  const context = usePlugin()
  // The host does not close plugin session panels for us — bind the panel's
  // own close action. Layers created here live exactly as long as the panel
  // component and are active only while the panel owns input.
  context.keymap.layer(() => ({
    commands: [
      {
        id: "quota-lab.panel.close",
        bind: "escape",
        run: () => {
          props.panel?.close?.()
        },
      },
      {
        id: "quota-lab.panel.close.q",
        bind: "q",
        run: () => {
          props.panel?.close?.()
        },
      },
    ],
  }))
  startClock()
  const { message, status } = useQuotaMessage(() => props.panel?.sessionID ?? "")
  const panelWidth = () => {
    const w = props.panel && (typeof props.panel.width === "function" ? props.panel.width() : props.panel.width)
    return Math.max(32, Math.min(96, (typeof w === "number" ? w : 60) - 8))
  }
  const rows = createMemo(() => parsePanel(message()))
  const bars = createMemo(() => rows().filter((r): r is Extract<Row, { kind: "bar" }> => r.kind === "bar"))
  const tidePct = () => bars()[0]?.pct ?? 0
  const caption = createMemo(() => {
    const names = ["5h", "Weekly", "Monthly"]
    const parts = bars().map((b, i) => `${names[i] ?? "window"} ${Math.round(b.pct)}%`)
    return parts.length > 0 ? `${parts.join("  ·  ")}   —   the first window drives the tide` : "waiting for quota data…"
  })
  return (
    <ErrorBoundary
      fallback={(err: any) => (
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.muted }}>
            {`[quota-lab] panel render-error · ${String(err?.message ?? err).slice(0, 70)}`}
          </span>
        </text>
      )}
    >
      <box flexDirection="column">
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.base }}>Quota Lab — seaside</span>
          <span style={{ fg: context.theme.text.muted }}>{`  —  the tide line is your quota  (${status()})`}</span>
        </text>
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.muted }}>{caption()}</span>
        </text>
        <text> </text>
        <SceneView width={panelWidth()} percent={tidePct()} />
        <text> </text>
        <text wrapMode="none">
          <span style={{ fg: context.theme.text.muted }}>{"Escape closes · exact seiche · wall swash"}</span>
        </text>
      </box>
    </ErrorBoundary>
  )
}

// ---- plugin ----
export default Plugin.define({
  id: "quota-lab.tui",
  setup(context: any) {
    // No process-wide "already mounted" guard here: OpenCode disposes a
    // plugin's slots/commands on reload and calls setup again. A global guard
    // would make every setup after the first return early, leaving the
    // extension unregistered after a reload (sidebar + /quotalab disappear).
    console.log("[quota-lab] tui plugin loaded")
    try {
      context.ui.toast.show({ message: "Quota Lab loaded", variant: "success", duration: 3000 })
    } catch {}

    const offSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props: any) => <QuotaSection sessionID={props.sessionID} width={props.width} />,
    })

    const offPanel = context.ui.slot({
      append: "session.panel",
      render: (panel: any) => (
        <Show when={panel.name === "quota-lab.panel"}>
          <LabPanel panel={panel} />
        </Show>
      ),
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "quota-lab.open",
          title: "Open Quota Lab",
          group: "Quota Lab",
          palette: true,
          slash: { name: "quotalab" },
          enabled: () => true,
          run: () => {
            context.ui.panel.open("quota-lab.panel")
          },
        },
        {
          id: "quota-lab.style",
          title: "Quota Lab: switch bar style",
          group: "Quota Lab",
          palette: true,
          slash: { name: "quotastyle" },
          enabled: () => true,
          run: async () => {
            try {
              const picked = await context.ui.dialog.select({
                title: "Quota bar style",
                placeholder: "Search styles",
                current: currentStyle().id,
                options: STYLES.map((s) => ({ title: s.title, value: s.id, description: s.description })),
              })
              if (typeof picked !== "string") return
              const style = setStyle(picked)
              if (style) context.ui.toast.show({ message: `Quota style: ${style.title}`, variant: "success", duration: 2000 })
            } catch (error) {
              context.ui.toast.show({
                message: `Quota style picker failed: ${error instanceof Error ? error.message : String(error)}`,
                variant: "error",
                duration: 4000,
              })
            }
          },
        },
      ],
      bindings: ["quota-lab.open"],
    }))

    return () => {
      stopClock()
      if (typeof offSidebar === "function") offSidebar()
      if (typeof offPanel === "function") offPanel()
    }
  },
})
