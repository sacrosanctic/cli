# Migration Plan: `sv/create` decomposition

Decisions locked: shared/ dies completely, assets inline as TS strings, single PR with ordered commits.

## Commit 1 — Playground → CLI

- Move `create/playground.ts` → `cli/playground.ts`; re-point sole importer (`cli/create.ts:26-32`)
- Inline `PlaygroundLayout.svelte` as a TS string export (AST hooks in `playground.ts:199-218` operate on source text, so this is safe)
- Move `create/tests/playground.ts` → `cli/tests/`; delete `+playground/`; drop `'playground'` from `Condition`

## Commit 2 — ai-tools owns its assets

- Inline `+mcp/AGENTS.md`, `+skills/**` (2 SKILL.md + 9 references), `+agents/svelte-file-editor.md` as TS string exports (e.g. `addons/ai-tools-assets.ts`)
- Derive `TOOLS` labels from those constants; remove `getSharedFiles()` usage (`ai-tools.ts:206-210`) and its stale comment (`:120`)
- Delete the three dirs; drop `'mcp'|'skills'|'agents'` from `Condition`

## Commit 3 — Templates own their prose

- Root `README.md` → `templates/minimal/` + `templates/library/`; `+addon/{README.md,CONTRIBUTING.md}` → `templates/addon/`; `+library/README.md` merges into library's copy
- Verify `.md` assets still flow through `kv()` `$SV-NAME-TODO$` replacement via the normal `assets/` copy path (`create/utils.ts:53`)
- Remove the shared-set skip logic in `build-templates.js:117` only after confirming nothing else collides

## Commit 4 — vite.config per-template, kill shared/

- Copy `shared/vite.config.ts` into `templates/minimal/` + `templates/library/`
- **Diff demo's own `vite.config.js` against the shared one** — if they diverge, decide which wins (snapshot churn either way)
- Delete: `shared/`, `getSharedFiles()`, `Common`, `write_common_files`, `merge()`, `sort_keys()`, `sort_files()` (`create/index.ts:87-179`), `generate_shared()` + `shared.json` in `build-templates.js`
- Keep the addon-template `rmSync` cleanup (`index.ts:48-57`) — it also removes `svelte.config.*`, whose origin is outside shared

## Commit 5 — Config codegen

- New `create/configs.ts`: `(template, types) → tsconfig|jsconfig contents`, reproducing all 6 current variants byte-for-byte (watch the `+none` vs `+checkjs` jsconfig delta and library include overrides); written directly by `create()`
- Replace `+{typescript,checkjs}/package.json` fragments with programmatic edits via sv-utils `transforms.json`: conditionally add `check`/`check:watch` scripts + `svelte-check`/`typescript` devDeps when `types !== 'none'`; preserve alphabetization on final write
- Delete the 6 variant dirs

## Commit 6 — Internal scaffold addon + bootstrap

- Wrap scaffolding as internal addon (template/types as select options), **not** registered in `officialAddons`; keep the low-level `create()` exported (`src/index.ts`) as the shared primitive for the addon wrapper and `testing.ts`
- Relocate `createVirtualWorkspace` → core bootstrap that writes an empty project skeleton (valid `package.json`) so engine workspace validation passes; scaffold addon occupies a guaranteed first slot in the engine pipeline
- Slim `cli/create.ts` to prompts + playground flag + next-steps orchestration
- Regenerate `cli/tests/snapshots/*` and check `api-surface.md` / `dts-api-surface` for export drift

## Verification (every commit)

`tsgo` check, lint/format, unit + addon snapshot tests, full `pnpm build` (build-hook changes affect dist layout), plus manual smoke:

- `create --template minimal --types ts`
- `create --from-playground <url>`
- `create --template addon`
- `sv add` on an existing project

## Residual risks

1. Demo vite.config divergence surfacing in commit 4
2. `svelte.config.*` provenance assumption in commit 4's cleanup retention
3. Byte-parity of generated configs in commit 5 — mitigate with a temporary parity test against pre-refactor output
