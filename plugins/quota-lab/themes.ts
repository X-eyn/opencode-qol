// Extra PixelSea themes (pure data, no runtime imports, so the browser
// preview can load them too). MIAMI_DUSK lives in ./pixelsea as the default.
import { MIAMI_DUSK, type SeaTheme } from "./pixelsea"

// Night on a lagoon: navy sky, a low moon laying a shimmering path on the
// water, bioluminescent foam and spray, silver sand, palms as silhouettes.
export const MOONLIT_LAGOON: SeaTheme = {
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
    [64, 104, 124],
  ],
  towerLeg: [112, 116, 134],
  gull: [168, 174, 192],
  moon: true,
  stars: 0.012,
}

// The first pixel sea: plain turquoise tank and golden sand, no beach props.
export const TURQUOISE_TANK: SeaTheme = {
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
  stars: 0.007,
}
