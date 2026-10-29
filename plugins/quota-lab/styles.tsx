// Quota bar style presets.
//
// A style is either a PixelSea theme (real pixel framebuffer over Sixel) or the
// classic cell strip. The active style is a signal, so every bar re-renders
// the moment it changes, and it is saved to ~/.config/opencode/quota-lab.json
// so it survives restarts. Switch with /quotastyle.
//
// To add a look: write a Scene (./scene) or a theme for an existing one, and
// append a { kind: "pixel", create } entry to STYLES.
import { readFileSync, writeFileSync } from "node:fs"
import { createSignal } from "solid-js"
import { MIAMI_DUSK, PixelSea, type SeaTheme } from "./pixelsea"
import { MOONLIT_LAGOON, TURQUOISE_TANK } from "./themes"
import { JEDI_BLUE, SITH_RED, LightsaberScene, type SaberTheme } from "./lightsaber"
import { RetroTankScene } from "./retro"
import { PocketSnake, BurningFuse, Chomper, LavaFlow, SynthwaveSunset } from "./retro-scenes"
import type { SceneFactory } from "./scene"

const sea = (theme: SeaTheme): SceneFactory => (W, H, seed) => new PixelSea(W, H, seed, theme)
const saber = (theme: SaberTheme): SceneFactory => (W, H, seed) => new LightsaberScene(W, H, seed, theme)

export type BarStyle =
  | { id: string; title: string; description: string; kind: "pixel"; create: SceneFactory }
  | { id: string; title: string; description: string; kind: "cells" }

export const STYLES: BarStyle[] = [
  {
    id: "retro-tank",
    title: "Retro Tank · 8-bit",
    description: "The original water bar as dithered 8-bit pixel art",
    kind: "pixel",
    create: (W, H, seed) => new RetroTankScene(W, H, seed),
  },
  {
    id: "retro-seawall",
    title: "Sea Wall · 8-bit",
    description: "The storm sea with no beach: waves slam into the quota line",
    kind: "pixel",
    create: (W, H, seed) => new RetroTankScene(W, H, seed, true),
  },
  {
    id: "retro-snake",
    title: "Pocket Snake · 8-bit",
    description: "Handheld-green snake, its length is your remaining quota",
    kind: "pixel",
    create: (W, H, seed) => new PocketSnake(W, H, seed),
  },
  {
    id: "retro-fuse",
    title: "Burning Fuse · 8-bit",
    description: "A spark eats the fuse toward the bomb as quota burns",
    kind: "pixel",
    create: (W, H, seed) => new BurningFuse(W, H, seed),
  },
  {
    id: "retro-chomper",
    title: "Chomper · 8-bit",
    description: "Maze muncher, the dots ahead are your remaining quota",
    kind: "pixel",
    create: (W, H, seed) => new Chomper(W, H, seed),
  },
  {
    id: "retro-lava",
    title: "Lava Flow · 8-bit",
    description: "Molten lava with crust plates, cooling to basalt",
    kind: "pixel",
    create: (W, H, seed) => new LavaFlow(W, H, seed),
  },
  {
    id: "retro-synth",
    title: "Synthwave Sunset · 8-bit",
    description: "Neon grid rolling toward a striped sun",
    kind: "pixel",
    create: (W, H, seed) => new SynthwaveSunset(W, H, seed),
  },
  {
    id: "miami",
    title: "Miami Dusk",
    description: "Pale sand, turquoise shallows, palms, lifeguard tower",
    kind: "pixel",
    create: sea(MIAMI_DUSK),
  },
  {
    id: "lagoon",
    title: "Moonlit Lagoon",
    description: "Night sea, moonlight path, glowing surf, silhouettes",
    kind: "pixel",
    create: sea(MOONLIT_LAGOON),
  },
  {
    id: "tank",
    title: "Turquoise Tank",
    description: "Plain pixel sea and golden sand, no props",
    kind: "pixel",
    create: sea(TURQUOISE_TANK),
  },
  {
    id: "saber-jedi",
    title: "Lightsaber · Jedi Blue",
    description: "Ignited blade, its length is your remaining quota",
    kind: "pixel",
    create: saber(JEDI_BLUE),
  },
  {
    id: "saber-sith",
    title: "Lightsaber · Sith Red",
    description: "Unstable crackling crimson blade, length = quota left",
    kind: "pixel",
    create: saber(SITH_RED),
  },
  {
    id: "classic",
    title: "Classic Strip",
    description: "Character-cell wave strip (no pixel graphics)",
    kind: "cells",
  },
]

const DEFAULT_STYLE = "miami"
const STATE_FILE = new URL("../../quota-lab.json", import.meta.url) // ~/.config/opencode/quota-lab.json

function loadStyleId(): string {
  const env = (globalThis as any).process?.env ?? {}
  if (env.QUOTA_LAB_PIXELS === "0") return "classic"
  try {
    const id = JSON.parse(readFileSync(STATE_FILE, "utf8"))?.style
    if (typeof id === "string" && STYLES.some((s) => s.id === id)) return id
  } catch {}
  return DEFAULT_STYLE
}

const [styleId, setStyleId] = createSignal(loadStyleId())

export function currentStyle(): BarStyle {
  const id = styleId()
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

export function setStyle(id: string): BarStyle | undefined {
  const style = STYLES.find((s) => s.id === id)
  if (!style) return undefined
  setStyleId(id)
  try {
    let state: Record<string, unknown> = {}
    try {
      state = JSON.parse(readFileSync(STATE_FILE, "utf8")) ?? {}
    } catch {}
    writeFileSync(STATE_FILE, JSON.stringify({ ...state, style: id }, null, 2) + "\n")
  } catch {}
  return style
}
