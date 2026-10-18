# Changelog

## 0.1.0

First release. krafta combines [lintapple](https://github.com/gholtzap/lintapple) and [interface-craft](https://github.com/harun-yardimci/interface-craft) in one package.

- `krafta check`: the design-policy gate from lintapple, with class and attribute theme toggles, storage state for signed-in pages, and `CHROME_PATH`.
- `krafta audit`: the interface-craft render audit in strict TypeScript. It also runs the gate rules in the same pass, lists them first, and numbers them on the annotated screenshot.
- `krafta scan`: the interface-craft theme, token and hit-area scanners in TypeScript, with config exceptions and inline `krafta-ignore` comments that need a reason.
- `krafta tile`, `krafta init`, `krafta skill`.
- One `krafta.config.json` with a JSON schema. A lintapple `ui-policy.json` still works.
- One agent skill for Claude Code and Codex, also installable as a Claude Code plugin.
- `expectUI` for Playwright tests.
