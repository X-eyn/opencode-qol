// A pixel scene: anything that can fill an RGBA framebuffer for one quota
// bar. PixelSea (the beach) and LightsaberScene implement it; styles supply a
// factory, so new looks are a new scene file plus one registry entry.
export interface Scene {
  setPercent(pct: number): void
  step(dt: number): void
  render(buf: Uint8Array): void
  // optional: the colour behind the bar (the theme's background), so a
  // scene with an empty backdrop blends into the card instead of boxing it
  setBackground?(rgb: number[]): void
  // optional: take over the state of the scene this one replaces (same bar,
  // new pixel size) so the swap is seamless - e.g. a lightsaber stays lit
  // instead of re-igniting from the hilt
  handover?(prev: Scene): void
}
export type SceneFactory = (W: number, H: number, seed: number) => Scene
