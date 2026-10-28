import { Plugin } from "@opencode/plugin"

// Server-side half of the quota-lab plugin. The quota data itself is served by
// @slkiser/opencode-quota over its RPC (id "slkiser.opencode-quota"); this
// package only contributes the TUI rendering (see ./tui.tsx). The server half
// exists so the package has a main entrypoint and can grow server-side
// features (persistence, exports) later.
export default Plugin.define({
  id: "quota-lab",
  setup() {},
})
