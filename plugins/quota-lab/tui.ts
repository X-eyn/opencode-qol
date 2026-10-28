// TUI entrypoint convention shim: some loaders look for `tui.ts` next to
// `index.ts`, others resolve the package.json `exports["./tui"]`. Both paths
// lead to the same implementation.
export { default } from "./tui.tsx"
