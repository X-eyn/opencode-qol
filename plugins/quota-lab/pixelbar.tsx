// PixelBar — one quota bar rendered as a real pixel framebuffer.
//
// A Scene (./scene: the beach, the lightsaber, ...) paints an RGBA buffer at the terminal's
// image-protocol pixel size; OpenTUI's <image> renderable ships it to the
// terminal over Sixel/Kitty. Terminals with no image protocol get the cell
// strip instead (the `fallback` render prop).
//
// Simulations live in a module-level map keyed per window, so the sidebar
// re-rendering its rows (every quota refresh) never resets the sea.
import { NativeImagePool } from "@opentui/core"
import { readFileSync, writeFileSync } from "node:fs"
import { Show, createSignal, onCleanup } from "solid-js"
import type { Scene, SceneFactory } from "./scene"

const FRAME_MS = 80

// ONE animation clock for every bar. Separate per-bar timers ran out of step,
// so each 80ms the terminal got three staggered image updates (up to ~37
// redraws a second, each a fresh Sixel send) - more chances to catch a
// half-painted frame. Now all bars render and swap their images in the same
// instant: one complete update per tick.
const tickers = new Set<() => void>()
let clock: ReturnType<typeof setInterval> | undefined
function subscribe(fn: () => void) {
  tickers.add(fn)
  if (!clock) clock = setInterval(() => {
    for (const t of tickers) t()
  }, FRAME_MS)
  return () => {
    tickers.delete(fn)
    if (tickers.size === 0 && clock) {
      clearInterval(clock)
      clock = undefined
    }
  }
}

// One scene per bar and style, for the bar's whole life. A genuine pixel-size
// change replaces it, but the new scene inherits the old one's state
// (handover), so nothing restarts - a fresh lightsaber starts OFF and
// re-ignites, which showed as a blink to black.
const scenes = new Map<string, { sc: Scene; w: number; h: number }>()
let sceneCreates = 0
function sceneFor(key: string, styleId: string, create: SceneFactory, w: number, h: number, seed: number): Scene {
  const k = `${key}:${styleId}`
  const cur = scenes.get(k)
  if (cur && cur.w === w && cur.h === h) return cur.sc
  const sc = create(w, h, seed)
  if (cur && sc.handover) sc.handover(cur.sc)
  scenes.set(k, { sc, w, h })
  sceneCreates++
  note({ sceneCreates, lastScene: `${k} ${w}x${h}` })
  return sc
}

// Pixel size of ONE terminal cell as the image protocol sees it. Windows
// Terminal reports (and scales Sixel against) a 10x20 virtual cell; other
// terminals report their real cell size via the pixel resolution query.
// QUOTA_LAB_CELL_PX=WxH overrides.
function cellPx(ctx: any): { cw: number; ch: number } {
  const env = (globalThis as any).process?.env ?? {}
  const forced = /^(\d+)x(\d+)$/.exec(String(env.QUOTA_LAB_CELL_PX ?? ""))
  if (forced) return { cw: Number(forced[1]), ch: Number(forced[2]) }
  const res = ctx?.resolution
  const tw = ctx?.terminalWidth ?? 0
  const th = ctx?.terminalHeight ?? 0
  // snapped to whole pixels: a resolution report that wobbles by a fraction
  // must not change the canvas size
  if (res && res.width > 0 && res.height > 0 && tw > 0 && th > 0) return { cw: Math.round(res.width / tw), ch: Math.round(res.height / th) }
  return { cw: 10, ch: 20 }
}

// Diagnostics: how many times bars were created. In a healthy card this is
// one per bar per OpenCode start (plus one per style switch); recorded in
// ~/.config/opencode/quota-lab.json as "barMounts".
let mounts = 0
function note(fields: Record<string, unknown>) {
  try {
    const url = new URL("../../quota-lab.json", import.meta.url)
    let state: Record<string, unknown> = {}
    try {
      state = JSON.parse(readFileSync(url, "utf8")) ?? {}
    } catch {}
    writeFileSync(url, JSON.stringify({ ...state, ...fields }, null, 2) + String.fromCharCode(10))
  } catch {}
}
function noteMount(id: string) {
  mounts++
  note({ barMounts: mounts, lastMount: `${id} @ ${new Date().toISOString()}` })
}

export function PixelBar(props: {
  id: string
  seed: number
  cols: number
  percent: number
  styleId: string
  create: SceneFactory
  bg?: string // theme background (#rrggbb) for scenes with an empty backdrop
  fallback: () => any
}) {
  const [useCells, setUseCells] = createSignal(false)
  let node: any
  let pool: NativeImagePool | undefined
  let poolW = 0
  let poolH = 0
  let buf = new Uint8Array(0)
  let last = performance.now()
  let checked = false
  let lastFp = 0
  let sentOnce = false
  // canvas size, debounced: a new size is adopted only after it holds for
  // several consecutive frames (the first size is taken immediately)
  let sizeW = 0
  let sizeH = 0
  let candW = 0
  let candH = 0
  let candN = 0

  // Size the target to exactly the box (the stock renderSelf derives it from
  // the reported resolution and can over-size it; Sixel output is never
  // clipped by the parent box, so an over-sized image spills out of the card).
  const attach = (r: any) => {
    node = r
    if (!r || r.__quotaLabPatched) return
    r.__quotaLabPatched = true
    // draw the first frame right away: a new bar must never sit blank for a
    // tick (that gap is a visible blink)
    queueMicrotask(() => tick())
    r.renderSelf = function (buffer: any) {
      const img = this._image
      if (!img || this.width <= 0 || this.height <= 0) return
      const x = this.buffered ? 0 : this._screenX
      const y = this.buffered ? 0 : this._screenY
      const c = cellPx(this._ctx)
      const pw = Math.max(1, Math.round(this.width * c.cw))
      const ph = Math.max(1, Math.round(this.height * c.ch))
      buffer.drawImage(img, x, y, this.width, this.height, pw, ph, 0, 0, img.width, img.height, this._protocol)
    }
  }

  const tick = () => {
    if (!node || useCells()) return
    if (!checked) {
      checked = true
      if (node.effectiveProtocol === "blocks") {
        // no image protocol: the pixel canvas would degrade to blocks; the
        // purpose-built cell strip looks better there
        setUseCells(true)
        return
      }
    }
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    const c = cellPx(node._ctx)
    const nw = Math.max(8, Math.round(props.cols * c.cw))
    const nh = Math.max(4, Math.round(c.ch))
    if (sizeW === 0) {
      sizeW = nw
      sizeH = nh
    } else if (nw !== sizeW || nh !== sizeH) {
      if (nw === candW && nh === candH) candN++
      else {
        candW = nw
        candH = nh
        candN = 1
      }
      if (candN >= 4) {
        sizeW = nw
        sizeH = nh
        candN = 0
      }
    } else candN = 0
    const w = sizeW
    const h = sizeH
    if (!pool || w !== poolW || h !== poolH) {
      pool?.dispose()
      pool = new NativeImagePool({ width: w, height: h, capacity: 3 })
      poolW = w
      poolH = h
      buf = new Uint8Array(w * h * 4)
    }
    const sea = sceneFor(props.id, props.styleId, props.create, w, h, props.seed)
    if (sea.setBackground && props.bg) {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(props.bg)
      if (m) sea.setBackground([parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)])
    }
    sea.setPercent(props.percent)
    sea.step(dt)
    sea.render(buf)
    // send only frames that differ from the one on screen (a still scene
    // then costs no Sixel traffic at all)
    let fp = 2166136261
    for (let i = 0; i < buf.length; i += 28) fp = Math.imul(fp ^ buf[i] ^ (buf[i + 1] << 8) ^ (buf[i + 2] << 16), 16777619)
    if (fp === lastFp && sentOnce) return
    lastFp = fp
    sentOnce = true
    const img = pool.publishRgba(buf)
    if (img) {
      node.source = img
      img.dispose() // the renderable holds its own reference
    }
  }
  const unsubscribe = subscribe(tick)
  noteMount(props.id)

  onCleanup(() => {
    unsubscribe()
    pool?.dispose()
    pool = undefined
  })

  return (
    <Show when={!useCells()} fallback={props.fallback()}>
      <image ref={attach} width={props.cols} height={1} fit="fill" />
    </Show>
  )
}
