import { PixelSea, MIAMI_DUSK } from "../plugins/quota-lab/pixelsea.ts"
import { MOONLIT_LAGOON, TURQUOISE_TANK } from "../plugins/quota-lab/themes.ts"
;(globalThis as any).PixelSea = PixelSea
;(globalThis as any).THEMES = { miami: MIAMI_DUSK, lagoon: MOONLIT_LAGOON, tank: TURQUOISE_TANK }
