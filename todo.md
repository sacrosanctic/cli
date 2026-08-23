# Migration Plan: `sv/create` decomposition

Status: **complete** — all phases implemented and committed.

Decisions locked: shared/ dies completely, per-consumer `template/` asset directories with a generic build+runtime mechanism, single branch with ordered commits.

## Commit 1 — Playground → CLI ✅ af1d255c

- [x] Move `create/playground.ts` → `cli/playground.ts`; re-point sole importer (`cli/create.ts`)
- [x] Keep `PlaygroundLayout.svelte` as a real file at `create/template/playground/src/lib/`, shipped under the `scaffold` key and read via `getTemplateFiles('scaffold')` (AST placeholder hooks unchanged)
- [x] Move `create/tests/playground.ts` → `cli/tests/`; delete `+playground/`; drop `'playground'` from `Condition`

## Commit 2 — ai-tools owns its assets ✅ 91bddff7

- [x] Move `+mcp/AGENTS.md`, `+skills/**` (2 SKILL.md + 9 references), `+agents/svelte-file-editor.md` into real files under `addons/ai-tools/template/{mcp,skills,agents}/`, consumed via `getTemplateFiles('ai-tools')`
- [x] Derive tool files from those constants; remove `getSharedFiles()` usage and stale comment
- [x] Delete the three dirs; drop `'mcp'|'skills'|'agents'` from `Condition`

## Commit 3 — Templates own their prose ✅ 4b985574

- [x] Root `README.md` → `templates/minimal/` (demo gets the same generic README it was already receiving at runtime); `+library/README.md` → `templates/library/`
- [x] `+addon/{README.md,CONTRIBUTING.md}` → `templates/addon/`
- [x] `.md` assets still flow through `kv()` `$SV-NAME-TODO$` replacement via the normal `assets/` copy path
- [x] demo `.ignore` updated: stop excluding `README.md`, exclude dev-time `tsconfig.json`

## Commit 4 — vite.config per-template, kill shared/ ✅ af00005b (+ 26a0bdb7)

- [x] Copy `shared/vite.config.ts` into `templates/{minimal,library,demo}/` (the stale template-local `.js` copies were missing the runes compilerOptions block)
- [x] Delete: `shared/`, `getSharedFiles()`, `Common`, `write_common_files`, `merge()`, `sort_files()`, `generate_shared()` + `shared.json`
- [x] Addon-template `rmSync` cleanup retained (also covers `svelte.config.*`)
- [x] build-templates.js: normalize glob path separators so manifests are identical across platforms

## Commit 5 — Config codegen ✅ af00005b (+ 26a0bdb7)

- [x] New `create/configs.ts`: `(template, types) → tsconfig|jsconfig contents` reproducing all previous variants byte-for-byte; written directly by `create()`
- [x] `+{typescript,checkjs}/package.json` fragments replaced by programmatic edits (`getTypeCheckingPackageJsonEdits`)
- [x] Delete the 6 variant dirs; keep slim `sort_keys()` for package.json finalization
- [x] Parity regression test (`create/tests/parity.ts`) asserting byte-identical output vs pre-refactor baseline fixture for all 12 template×language combos — passing

## Commit 6 — Internal scaffold addon + bootstrap ✅ 84d26822

- [x] `createVirtualWorkspace` → `core/bootstrap.ts` as `createBootstrapWorkspace`; now writes an empty project skeleton (package.json) so the engine workspace is valid before any add-on runs
- [x] Internal scaffold add-on (`create/addon.ts`, id `'scaffold'`), not registered in `officialAddons`; `sv create` runs it first via a real SvApi context
- [x] Low-level `create()` remains exported from `src/index.ts` for `testing.ts` and programmatic use
- [x] Slimmed `cli/create.ts` imports (removed local virtual-workspace machinery, `createKit` alias, unused utils)

## Verification performed

- [x] `tsgo` typecheck clean at every phase
- [x] eslint clean on all touched files
- [x] Full `pnpm build` regenerates dist (stale dist wiped first)
- [x] Parity tests: 12/12 passing
- [x] Core unit tests: 27/27 passing
- [x] CLI smoke: `create --template minimal --types ts --no-install --no-add-ons` output matches baseline (modulo intentional CLI deltas: project name from directory, updateReadme recreation command injection)
- [x] CLI smoke: `--template addon --addon-name @test/my-addon` ships template-owned README/CONTRIBUTING + standalone jsconfig, sanitized package name

## Residual risks / follow-ups

1. Demo vite.config divergence resolved: shared version won (template copies were stale)
2. Playground network tests (`cli/tests/playground.ts`) and heavy integration tests (`create/tests/check.ts`, snapshot tests) were not run locally — recommend a full `pnpm test:ci` in CI
3. Scaffold add-on prompt definitions duplicate the CLI's inline prompts; a follow-up can derive CLI prompts from the add-on options
4. Engine pipeline doesn't yet run scaffold through `orderAddons`/`applyAddons` — scaffold is invoked explicitly first in `createProject`; deeper engine integration can come later
