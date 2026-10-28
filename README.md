# opencode-qol

My OpenCode setup (`~/.config/opencode`): config, theme and **Quota Lab**, a custom TUI plugin
that redraws the quota sidebar with a pixel graphics engine rendered over Sixel.

## What's in here

| Path | What it is |
| --- | --- |
| `opencode.jsonc` | Main config: the `@slkiser/opencode-quota` server plugin, the Spectrum UI MCP server, providers |
| `tui.jsonc` | Loads the local Quota Lab TUI plugin |
| `cli.json` | Theme (`orng`, dark), sidebar and session preferences |
| `package.json` | Plugin SDK dependency (OpenCode installs it automatically) |
| `quota-lab.json` | Quota Lab state: selected bar style plus diagnostics counters |
| `plugins/quota-lab/` | The Quota Lab plugin (see below) |
| `opencode-quota/` | Toast config and the earlier colour patch for the stock quota TUI (with its backups) |
| `quota-lab-preview/`, `quota-preview.html` | Offline preview pages and rendered PNG sheets of the bar styles |
| `dev-tools/` | Node test and preview scripts for the simulations |

### Quota Lab plugin (`plugins/quota-lab/`)

- `tui.tsx`: the sidebar card (layout, text, `/quotastyle` command)
- `pixelbar.tsx`: renders one bar as an RGBA framebuffer through OpenTUI's `<image>` (Sixel/Kitty)
- `styles.tsx`: the style registry for `/quotastyle`
- `scene.ts`: the scene interface
- `retro.ts` + `surf.ts`: Retro Tank · 8-bit, a storm sea from a shallow-water/Boussinesq wave model
- `retro-scenes.ts`: Pocket Snake, Burning Fuse, Chomper, Lava Flow, Synthwave Sunset
- `pixelsea.ts`, `themes.ts`: Miami Dusk, Moonlit Lagoon, Turquoise Tank beaches
- `lightsaber.ts`: Jedi Blue and Sith Red lightsabers
- `water.ts`: the original cell-based water engine (used when the terminal has no image protocol)

## Restore on another device

1. Install OpenCode.
2. Move any existing config out of the way, then clone into the config folder:

   ```bash
   mv ~/.config/opencode ~/.config/opencode.old 2>/dev/null
   git clone https://github.com/X-eyn/opencode-qol.git ~/.config/opencode
   ```

3. **Fix the plugin path in `tui.jsonc`.** It is an absolute `file:///` URL for user `Admin` on Windows.
   Point it at your own `plugins/quota-lab` folder, e.g. `file:///C:/Users/<you>/.config/opencode/plugins/quota-lab`
   or `file:///home/<you>/.config/opencode/plugins/quota-lab`.
4. Start OpenCode. It installs dependencies (`node_modules`) and the `@slkiser/opencode-quota` plugin by itself.
5. Sign in to your providers again (`opencode auth login`). Credentials are not stored in this repo.
6. Pick a bar style with `/quotastyle`.

**Not included:** `service.json`, which holds this machine's OpenCode remote-access password.
OpenCode creates a new one when you enable remote access on the new device.

The pixel bars need a terminal with Sixel or Kitty graphics (Windows Terminal, WezTerm, kitty, foot...).
Other terminals fall back to the cell-based bar.

## Dev tools

The scripts in `dev-tools/` run on Node 22 with `--experimental-strip-types`. They import the plugin
sources with explicit `.ts` extensions, so copy the sources next to them first, e.g.:

```bash
cd dev-tools
cp ../plugins/quota-lab/surf.ts .
sed 's#from "./surf"#from "./surf.ts"#' ../plugins/quota-lab/retro.ts > retro.ts
node --experimental-strip-types surf_test.ts
```
