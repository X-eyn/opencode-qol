# OpenCode Quota — sidebar effects patch

The `@slkiser/opencode-quota` plugin has no styling settings: the TUI sidebar renders
every line in `theme.text.muted`, `[Provider]` headers in `theme.text.base`, and bars
in muted gray. This patch adds two effects by editing the installed plugin's
`dist/tui.js`:

1. **Color patch** — semantic colors for numbers, bars, percents, countdowns.
2. **Effects patch** — burning 8-bit fire on the session input/output token
   numbers, plus **pixel-block lightsaber quota bars** (3 visible rows per bar,
   ported from the approved preview): a fixed hilt design and a blade whose
   length follows the live quota (plasma shimmer at 2.25×, tip bloom, halo).
3. **Card stroke** — a native rounded border card around the whole Quota
   section (header + bars + session tokens).
4. **Width patch** — the sidebar formatter is shrunk to 32 columns so all
   content fits inside the card stroke with zero clipping.

## Color patch

| Element | Color |
| --- | --- |
| Session input tokens (`55K`) | info (cyan/blue) |
| Session output tokens (`4.1K`) | success (green) |
| Cached input (`(726K)`) | muted (dim) |
| Quota bar fill and `NN%` | success ≥ 70% left, warning 30–69%, error < 30% (inverted for `% used`) |
| Bar's empty cells (`░`) | muted |
| Reset countdowns (`10d 18h 30m`) | accent (`text.action.primary.selected`) |
| `Session input/output tokens` heading | `text.base` (section title) |

Colors come from your active OpenCode theme tokens.

## Fire patch

The session input/output token numbers **burn**: each digit, suffix, and cached
parenthesis of `574K (17.6M) in  40K out` is drawn in an animated fire palette
(`#6E1400 → #FFE594`) while `in` / `out` stay muted.

- Heat is computed per character from layered sine + hash noise, then stepped
  through the palette with a **2×2 Bayer ordered dither**, so the glow shimmers
  like 8-bit flame rather than a smooth fade.
- Input-side numbers and output-side numbers use different seeds, so the two
  groups flicker independently.
- The animation runs on a shared 120 ms clock (`quotaFxPhase`); each
  character span updates its color reactively, so nothing resets when the
  sidebar data refreshes.
- Only the counts line is affected (detected by its `N in / N out` shape), not
  the heading, the model name, or quota rows.

Tuning knobs live in `fire.js`:

- `QUOTA_FIRE_PALETTE` — colors from darkest to hottest.
- `quotaTokenFireColor` — heat shape, flicker speed and dither strength.
- `quotaFireTokenCountsLine` — which lines are eligible to burn.
- The clock interval (120 ms) is in `startQuotaFxClock`.

## Water-tank bars (V17 — turquoise seiche, exact-solution physics)

The quota bars are wave tank sims, ported 1:1 from the approved
`preview-seiche-lab.html` **v15** model (turquoise baseline; speed 2.25×).
Each bar line renders as **one row**: 21 water cells + two spaces + the
9-char `NN% left/used` label, and the window name row above the bar is a
normal colored row again (classic layout, no fold).

**The physics** (evaluated per frame from the exact solution — nothing is
ad-hoc): 12 standing modes, each an exact pair of opposite-travelling waves
(d'Alembert decomposition), deep-water dispersion `omega ~ sqrt(n)` (short
waves run faster), perfectly reflecting walls (mode antinodes sit on both
edges, so crests double at the walls — clapotis — and re-launch), a Stokes
second-order term that sharpens crests, and two coherent travelling capillary
harmonics.

**Wall-splash micro-physics:** the engine scans each wall's surface history
(30 taps at 2-unit steps) for the peak rise rate, detects impact events, and
keys five effects off the event energy:
- **run-up overshoot** — the wall cell climbs beyond the modal prediction
  (coastal-engineering run-up behaviour), decaying ~2 cells inward;
- **rebound jet** — a fast white cap at the wall (2.6-unit decay);
- **ejecta train** — droplets walk inboard under ballistic deceleration
  (`x = v0*t - 0.5*a*t^2`), mass decaying exponentially, re-entering via
  coherent micro-ripples on the front;
- **clinging run-down** — the post-impact recession is damped (measured
  run-down is a fraction of run-up);
- **impact foam bloom** — extra foam where the slam happened.

Foam itself is wake-aware (samples the surface ~0.5 s in the past) and
coherent: the water body whitens smoothly with foam intensity and a spray cap
rides above the waterline, churning on a travelling phase — never per-cell
randomness. Palette: deep teal `#06272b` -> turquoise `#28b5ad` -> mint
`#a0f0e4`; foam `#e8fffb` / cap `#5fc8bd`.

Impact thresholds were measured from wall rise-rate distributions
(P50 0.069, max 0.395 per 2-unit step at baseline; thresholds scale linearly
with the tank rate).

Tuning knobs (in the injected block):

- `QUOTA_TANK_SPEED` (2.25), `QUOTA_TANK_MODES` (12), `QUOTA_TANK_W0` (0.26),
  `QUOTA_TANK_TSCALE` (0.5 — overall rate), `QUOTA_TANK_GAIN` (0.6 — swing).
- `QUOTA_TANK_PAL` (depth-gradient stops), `QUOTA_TANK_FOAM_FG`,
  `QUOTA_TANK_CAP_BASE`, `QUOTA_TANK_CAP_TOP`.
- `QUOTA_TANK_FOAM_AT` (0.8 — foam threshold), `QUOTA_TANK_SPRAY` (0.12 —
  pop probability), `QUOTA_TANK_LAG` (12 — wake memory).
- `QUOTA_TANK_RISE_MIN` / `QUOTA_TANK_RISE_MAX` (0.11 / 0.32 — impact
  detection window).

The equivalence suite (`validate-fx-v17.mjs`) proves the live cells match the
lab model exactly across a pct × phase grid (0 mismatches), plus live-block
byte parity, patch integrity, and a revert/re-apply byte-repro.

## Usage

## Card stroke (Quota section)

The whole Quota section (its `▼ Quota` header, bars, and session token rows) is
wrapped in a native OpenTUI border card:

- `border: true`, `borderStyle: "rounded"` — drawn by the host renderer, so the
  corners and lines are always pixel-perfect.
- `borderColor: theme.border.base` (the static orange stroke) and full
  sidebar-content width (`width: "100%"`), with 1 cell of inner padding
  left/right.
- The card spans the full sidebar-content width (`width: "100%"`) with 1 cell of inner padding left/right.
- Style can be switched to `"single"`, `"double"`, or `"heavy"`, and the color
  to any theme token (e.g. `theme.text.action.primary.selected` for an accent
  stroke) by editing the `borderStyle` / `borderColor` lines in the patch step
  of `apply-tui-colors.mjs`, then re-applying.

Note: the outer sidebar panel itself (the whole right column, including the
Context / MCP sections and the location footer) is drawn by OpenCode's own UI
code with a plain raised background and **no border hook** — CLI plugins cannot
stroke it. The card covers the part this patch owns.

## Width patch (no truncation)

The sidebar content area is exactly **36 columns**, and the card stroke consumes
4 of them (2 border + 2 padding). Without compensation, every 36-wide line
would clip by 4 characters (`99% left` → `99% l`, `2h 12m` → `2h`). So the
patch also edits the plugin's **server-side** formatter
(`dist/lib/tui-sidebar-format.js`):

```js
export const TUI_SIDEBAR_MAX_WIDTH = 32; /* __quotaWidthPatch__ ... */
```

Every sidebar line is now produced at 32 columns, matching the card's inner
width exactly: bars are 21 cells, labels show in full (` 99% left`), and
countdowns are complete (`2h12m`). Nothing clips, so there is no need to
scroll or hunt for truncated values.

This is a second patched file — `apply-tui-colors.mjs` patches, validates,
backs up, and can revert both files together.

## Usage

```powershell
# Re-apply after a plugin update (auto-discovers every installed copy):
node "$env:USERPROFILE\.config\opencode\opencode-quota\tui-color-patch\apply-tui-colors.mjs"

# Only report status:
node "$env:USERPROFILE\.config\opencode\opencode-quota\tui-color-patch\apply-tui-colors.mjs" --check

# Restore the previous version from backup (running it again goes one more step back):
node "$env:USERPROFILE\.config\opencode\opencode-quota\tui-color-patch\apply-tui-colors.mjs" --revert
```

Restart OpenCode after applying or reverting. One `--revert` restores the
colors-only version (fire removed); a second restores the pristine plugin.

## Files

- `colorizer.js` — semantic line colorizer injected into `dist/tui.js`.
- `fire.js` — effects block: burning-token fire, lightsaber bar renderer
  (hilt design + reactive blade), the shared animation clock, and the sidebar
  line/body builders.
- `apply-tui-colors.mjs` — idempotent apply / check / revert script (colors,
  effects/fire, body wiring, and the rounded card stroke; upgrades earlier
  versions in place). Backs up the target before writing and validates the
  patched file parses before saving.
- `tui.js.orig` — pristine copy of plugin v5.0.2 `dist/tui.js` (reference).
- `backups/` — timestamped originals + `manifest.json` used by `--revert`.

## Notes

- The patch targets OpenCode's package cache
  (`~/.cache/opencode/npm/@slkiser/opencode-quota@latest/...`). Updating the
  plugin replaces that file, so re-run the apply script afterwards.
- If the plugin's internal rendering layout changes in a future version, the
  script refuses to patch (it reports "unsupported plugin layout" / "could not
  locate sidebar body") instead of writing a broken file.
