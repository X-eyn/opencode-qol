#!/usr/bin/env node
/**
 * opencode-quota sidebar effects — install/reapply patch.
 *
 * Adds to the OpenCode Quota TUI sidebar:
 *   1. Color patch   — semantic colors for numbers, bars, percents, countdowns.
 *   2. Effects patch — burning token numbers; Ember Frontier bar animation,
 *                      ghost trail, low-quota pulse.
 *   3. Card stroke   — native rounded border card around the Quota section.
 *   4. Width patch   — shrinks the sidebar formatter (36 -> 32) in the plugin's
 *                      server file so nothing clips inside the card stroke.
 *
 * The plugin ships no styling settings, so this patch edits the installed
 * plugin's dist/tui.js. Re-run after the plugin is updated.
 *
 * Usage:
 *   node apply-tui-colors.mjs            Patch every installed copy (idempotent).
 *   node apply-tui-colors.mjs --check    Report patch status, change nothing.
 *   node apply-tui-colors.mjs --file <p> Patch one specific dist/tui.js.
 *   node apply-tui-colors.mjs --revert   Restore the newest backup for each target.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backupDir = join(scriptDir, "backups");
const manifestPath = join(backupDir, "manifest.json");
const colorizerPath = join(scriptDir, "colorizer.js");
const firePath = join(scriptDir, "fire.js");

const COLOR_MARKER = "__quotaColorPatchEnd__";
const FIRE_MARKER = "__quotaFirePatchV20__";
const FIRE_END_MARKER = "__quotaFirePatchEnd__";
const FIRE_BLOCK_START_V2 = "// __quotaFirePatchV";
const FIRE_BLOCK_START_V1 = "// __quotaFirePatch__ ";
const BODY_MARKER = "quotaSidebarBodyElements(props, lines())";
const BORDER_MARKER = "__quotaFramePatchEnd__";
const BORDER_HOLO_MARK = "__quotaFramePatchHolo__";
const BORDER_START_MARK = "// __quotaFramePatch__";
const BORDER_ANCHOR = /(_\$insertNode\(_el\$32, _el\$33\);\s*\n\s*_\$setProp\(_el\$32, "flexDirection", "column"\);)/;
const WIDTH_MARKER = "__quotaWidthPatch__";
const WIDTH_TARGET_LINE = /export const TUI_SIDEBAR_MAX_WIDTH = \d+;/;

function deriveWidthTarget(tuiTarget) {
  return join(dirname(tuiTarget), "lib", "tui-sidebar-format.js");
}
const BODY_START = "return lines().map(line =>";
const BODY_END = "})());";
const HELPER_ANCHOR = /^function SidebarQuotaView\(props\) \{/m;
const RENDER_RE =
  /( *)var (_el\$\d+) = _\$createElement\("text"\);\r?\n( *)_\$setProp\(\2, "wrapMode", "none"\);\r?\n( *)_\$insert\(\2, line \|\| " "\);\r?\n( *)_\$effect\(_\$p => _\$setProp\(\2, "fg", props\.context\.theme\.text\.muted, _\$p\)\);\r?\n( *)return \2;/;

function buildRenderReplacement(matchArgs) {
  const [, ind1, elVar, ind2, ind3, , indReturn] = matchArgs;
  const body = `${ind3}  `;
  return [
    `${ind1}var ${elVar} = _$createElement("text");`,
    `${ind2}_$setProp(${elVar}, "wrapMode", "none");`,
    `${ind3}// __quotaColorPatch__ render each segment with its own color.`,
    `${ind3}for (const segment of quotaSidebarLineSegments(line)) {`,
    `${body}const _el$span = _$createElement("span");`,
    `${body}_$insert(_el$span, segment.text);`,
    `${body}_$effect(_$p => _$setProp(_el$span, "style", { fg: segment.color(props.context.theme) }, _$p));`,
    `${body}_$insertNode(${elVar}, _el$span);`,
    `${ind3}}`,
    `${indReturn}return ${elVar};`,
  ].join("\n");
}

function findInstalledTargets() {
  const targets = [];
  const scopeRoots = [
    join(homedir(), ".cache", "opencode", "npm", "@slkiser"),
    join(homedir(), ".cache", "opencode", "packages", "@slkiser"),
  ];
  for (const scope of scopeRoots) {
    if (!existsSync(scope)) continue;
    for (const pkgDir of readdirSync(scope)) {
      if (!pkgDir.startsWith("opencode-quota")) continue;
      const pkgRoot = join(scope, pkgDir);
      const candidates = [join(pkgRoot, "node_modules", "@slkiser", "opencode-quota", "dist", "tui.js")];
      for (const sub of readdirSync(pkgRoot)) {
        candidates.push(join(pkgRoot, sub, "node_modules", "@slkiser", "opencode-quota", "dist", "tui.js"));
      }
      for (const candidate of candidates) {
        if (existsSync(candidate)) targets.push(candidate);
      }
    }
  }
  return [...new Set(targets)];
}

function findTypeScript() {
  const candidates = [
    join(homedir(), ".cache", "opencode", "packages", "@slkiser", "opencode-quota@latest", "node_modules", "typescript", "lib", "typescript.js"),
  ];
  const npmScope = join(homedir(), ".cache", "opencode", "npm", "@slkiser");
  if (existsSync(npmScope)) {
    for (const pkgDir of readdirSync(npmScope)) {
      for (const sub of readdirSync(join(npmScope, pkgDir))) {
        candidates.push(join(npmScope, pkgDir, sub, "node_modules", "typescript", "lib", "typescript.js"));
      }
    }
  }
  return candidates.find((candidate) => existsSync(candidate));
}

async function validateSyntax(filePath, source) {
  const tsPath = findTypeScript();
  if (!tsPath) return { ok: true, note: "typescript not found; skipped syntax validation" };
  const ts = (await import(`file:///${tsPath.replace(/\\/g, "/")}`)).default;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const diags = sf.parseDiagnostics ?? [];
  if (diags.length === 0) return { ok: true, note: "syntax ok" };
  const first = diags[0];
  const pos = sf.getLineAndCharacterOfPosition(first.start);
  const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
  return { ok: false, note: `syntax error at line ${pos.line + 1}: ${message}` };
}

function loadManifest() {
  if (!existsSync(manifestPath)) return [];
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }
}

function saveManifest(entries) {
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(entries, null, 2), "utf8");
}

function backupOf(target) {
  const manifest = loadManifest();
  return [...manifest].reverse().find((entry) => entry.target === target) ?? null;
}

function statusOf(source) {
  return {
    colors: source.includes(COLOR_MARKER),
    fire: source.includes(FIRE_MARKER),
    frame: source.includes(BODY_MARKER),
    border: source.includes(BORDER_MARKER),
  };
}

async function patchFile(target, { checkOnly }) {
  const source = readFileSync(target, "utf8");
  const before = statusOf(source);
  if (before.colors && before.fire && before.frame && before.border) {
    console.log(`already patched (colors + fire + border card): ${target}`);
    return true;
  }
  let patched = source;
  const applied = [];
  const anchorPresent = () => HELPER_ANCHOR.test(patched);

  if (!before.colors || !before.frame) {
    if (!anchorPresent()) {
      console.log(`skipped (no sidebar view; unsupported plugin layout): ${target}`);
      return false;
    }
    const colorizer = readFileSync(colorizerPath, "utf8").trimEnd();
    if (!before.colors) {
      patched = patched.replace(RENDER_RE, (...matchArgs) => buildRenderReplacement(matchArgs));
      patched = patched.replace(HELPER_ANCHOR, () => `${colorizer}\nfunction SidebarQuotaView(props) {`);
      applied.push("colors");
    }
  }
  if (!before.fire) {
    const fire = readFileSync(firePath, "utf8").trimEnd();
    let blockStart = patched.indexOf(FIRE_BLOCK_START_V2);
    if (blockStart < 0) blockStart = patched.indexOf(FIRE_BLOCK_START_V1);
    const blockEnd = blockStart < 0 ? -1 : patched.indexOf(FIRE_END_MARKER, blockStart);
    if (blockStart >= 0 && blockEnd >= 0) {
      // Upgrade an earlier effects block (strip fire, burning numbers) in place.
      patched = patched.slice(0, blockStart) + fire + patched.slice(blockEnd + FIRE_END_MARKER.length);
    } else {
      if (!anchorPresent()) {
        console.log(`skipped (no sidebar view; unsupported plugin layout): ${target}`);
        return false;
      }
      patched = patched.replace(HELPER_ANCHOR, () => `${fire}\nfunction SidebarQuotaView(props) {`);
    }
    applied.push("fire");
  }
  if (!patched.includes(BODY_MARKER)) {
    const start = patched.indexOf(BODY_START);
    const end = start < 0 ? -1 : patched.indexOf(BODY_END, start);
    if (start < 0 || end < 0) {
      console.log(`skipped (could not locate sidebar body to frame): ${target}`);
      return false;
    }
    patched =
      patched.slice(0, start) +
      "return quotaSidebarBodyElements(props, lines());" +
      patched.slice(end + BODY_END.length);
    applied.push("frame");
  }
  if (!patched.includes(BORDER_MARKER)) {
    const borderLines = [
      `    // __quotaFramePatch__ neat rounded card stroke around the Quota section.`,
      `    _$setProp(_el$32, "width", "100%");`,
      `    _$setProp(_el$32, "border", true);`,
      `    _$setProp(_el$32, "borderStyle", "rounded");`,
      `    _$setProp(_el$32, "paddingLeft", 1);`,
      `    _$setProp(_el$32, "paddingRight", 1);`,
      `    _$effect(_$p => _$setProp(_el$32, "borderColor", props.context.theme.border.base, _$p));`,
      `    // __quotaFramePatchEnd__`,
    ].join("\n");
    const bs = patched.indexOf(BORDER_START_MARK);
    let endMark = BORDER_MARKER;
    let be = bs < 0 ? -1 : patched.indexOf(endMark, bs);
    if (bs >= 0 && be < 0) {
      endMark = BORDER_HOLO_MARK;
      be = patched.indexOf(endMark, bs);
    }
    if (bs >= 0 && be >= 0) {
      // Upgrade an earlier stroke (static or holographic) in place.
      patched = patched.slice(0, bs) + borderLines + patched.slice(be + endMark.length);
    } else if (BORDER_ANCHOR.test(patched)) {
      patched = patched.replace(BORDER_ANCHOR, (match) => [match, borderLines].join("\n"));
    } else {
      console.log(`skipped (could not locate the Quota card root): ${target}`);
      return false;
    }
    applied.push("border");
  }
  if (checkOnly) {
    console.log(`not fully patched (${Object.entries(before).filter(([, v]) => !v).map(([k]) => k).join(", ")} missing): ${target}`);
    return false;
  }
  const validation = await validateSyntax(target, patched);
  if (!validation.ok) {
    console.log(`FAILED validation, left untouched: ${target}\n  ${validation.note}`);
    return false;
  }
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${stamp}__${target.replace(/[^A-Za-z0-9._@-]/g, "_")}.orig`;
  const backupPath = join(backupDir, backupName);
  copyFileSync(target, backupPath);
  const manifest = loadManifest();
  manifest.push({ target, backup: backupPath, at: stamp, applied });
  writeFileSync(target, patched, "utf8");
  saveManifest(manifest);
  console.log(`patched (${applied.join(", ")}): ${target}\n  backup: ${backupPath}\n  ${validation.note}`);
  return true;
}

async function patchWidthFile(target, { checkOnly }) {
  if (!existsSync(target)) {
    console.log(`skipped width patch (file not found): ${target}`);
    return false;
  }
  const source = readFileSync(target, "utf8");
  if (source.includes(WIDTH_MARKER)) {
    console.log(`width already patched: ${target}`);
    return true;
  }
  if (!WIDTH_TARGET_LINE.test(source)) {
    console.log(`skipped width patch (unsupported layout): ${target}`);
    return false;
  }
  if (checkOnly) {
    console.log(`width not patched: ${target}`);
    return false;
  }
  const patched = source.replace(
    WIDTH_TARGET_LINE,
    "export const TUI_SIDEBAR_MAX_WIDTH = 32; /* __quotaWidthPatch__: the card stroke takes 4 columns */"
  );
  const validation = await validateSyntax(target, patched);
  if (!validation.ok) {
    console.log(`FAILED width validation, left untouched: ${target}\n  ${validation.note}`);
    return false;
  }
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${stamp}__${target.replace(/[^A-Za-z0-9._@-]/g, "_")}.orig`;
  const backupPath = join(backupDir, backupName);
  copyFileSync(target, backupPath);
  const manifest = loadManifest();
  manifest.push({ target, backup: backupPath, at: stamp, applied: ["width"] });
  writeFileSync(target, patched, "utf8");
  saveManifest(manifest);
  console.log(`patched (sidebar width 36 -> 32): ${target}\n  backup: ${backupPath}\n  ${validation.note}`);
  return true;
}

async function revertFile(target) {
  const entry = backupOf(target);
  if (!entry || !existsSync(entry.backup)) {
    console.log(`no backup recorded for: ${target}`);
    return false;
  }
  copyFileSync(entry.backup, target);
  console.log(`reverted: ${target}\n  from: ${entry.backup}`);
  return true;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const revert = args.includes("--revert");
const fileFlagIndex = args.indexOf("--file");
const specificFile = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : null;

if (!existsSync(colorizerPath) || !existsSync(firePath)) {
  console.error(`missing ${colorizerPath} or ${firePath}`);
  process.exit(2);
}

const targets = specificFile ? [specificFile] : findInstalledTargets();
if (targets.length === 0) {
  console.log("no installed opencode-quota copies found");
  process.exit(0);
}
const specificIsWidth = Boolean(specificFile && specificFile.endsWith("tui-sidebar-format.js"));
for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`missing: ${target}`);
    continue;
  }
  if (specificIsWidth) {
    if (revert) await revertFile(target);
    else await patchWidthFile(target, { checkOnly });
    continue;
  }
  const widthTarget = deriveWidthTarget(target);
  if (revert) {
    await revertFile(target);
    if (existsSync(widthTarget) && backupOf(widthTarget)) await revertFile(widthTarget);
    continue;
  }
  const ok = await patchFile(target, { checkOnly });
  if (ok) await patchWidthFile(widthTarget, { checkOnly });
}
