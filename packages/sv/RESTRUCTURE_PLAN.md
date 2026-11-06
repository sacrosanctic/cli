# Restructure plan: separate public / internal / build-time code (`packages/sv`)

> Status: **planned, not yet executed.** This is a large, behavior-neutral refactor.
> Written 2026-10-17 after a TS9010 build failure exposed the lack of category boundaries.

## Motivation

`pnpm build` (tsdown) failed with:

```
TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.
  x const FileSchema = v.object({ name: v.string(), contents: v.string() });
    at packages/sv/src/create/index.ts:14
```

Root cause: `rolldown-plugin-dts` (generator `oxc`, see root `tsdown.config.ts`) produces `.d.mts`
under isolated-declarations rules — it cannot infer types, so any declaration it must emit needs an
explicit annotation. `create/index.ts` is a **public entry** module (`src/index.ts` re-exports `create`
from it), and it contained an **internal** schema const. The bug was a symptom of a structural problem:
nothing distinguishes public API code from internal runtime code from build-time code.

Temporary workaround: the schema lives in `src/core/common.ts` as `TemplateFileSchema` (with a comment),
where it is not reachable from the entry dts. The restructure below makes the boundary structural
instead of comment-enforced.

## Current state

### Categories today (and where they mix)

| Category                  | Files                                                                                                                                                                                                                                               | Mixing problems                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public API (runtime dts)  | `src/index.ts` barrel → `create/index.ts`, `core/engine.ts`, `core/config.ts`, `core/options.ts`, `core/workspace.ts`, `core/processors.ts`, `addons/index.ts` (+14 addon modules, `ids.ts`, `common.ts`), `create/templates.ts`, `create/utils.ts` | `create/index.ts` held internal schema consts; `create/utils.ts` also serves build scripts                     |
| Public devtime API        | `src/testing.ts` (published dts entry, documented in `api-surface-testing.md`)                                                                                                                                                                      | implementation is inline in the entry file, not a barrel                                                       |
| CLI (bin, not dts API)    | `bin.ts`, `src/cli/{add,check,create,migrate}.ts` + CLI-only modules: `core/fetch-packages.ts`, `core/formatFiles.ts`, `core/verifiers.ts`, `create/project.ts`, `addons/playground.ts`, whole `src/migrate/` tree                                  | `cli/add.ts` doubles as a library (`classifyAddons`, `resolveAddons`, …) used by `create/project.ts` and tests |
| Internal runtime          | `core/env.ts`, `core/errors.ts`, `core/package-manager.ts`, `core/deprecated.ts` (dead), plus `core/common.ts`                                                                                                                                      | —                                                                                                              |
| Build-time (tsdown hooks) | `src/create/scripts/{build-kit,build-vite,build-addon}-template.js`                                                                                                                                                                                 | live inside `src/`, `@import` types from runtime modules                                                       |

### `core/common.ts` grab-bag (420 lines, spans all categories)

- Schemas/types: `PackageJSONSchema`/`PackageJSON`, `TemplateFileSchema`/`TemplateFile`
- CLI UI: `cliOptions`, `helpConfig`, `getHelpSections`, `runCommand`, `errorAndExit`, `forwardExitCode`, `getPadding`, `buildAndLogArgs`
- Project file writers: `updateReadme`, `updateLibraryBuild`, `updateAgent`
- Generic utils: `normalizePosix`, `isNodeError`, `filePaths`, `parseAddonOptions`, `runAndValidateVerifications`

14 import sites, 4 of them `import * as common` namespace imports (`cli/add.ts`, `cli/create.ts`,
`cli/migrate.ts`, `create/project.ts`) which hide which members are actually used.

### Hard constraints (discovered, must not be violated)

1. `src/index.ts`, `src/testing.ts`, `bin.ts` are **path-pinned**: hardcoded in the `exports` map
   (`dist/src/index.d.mts` etc.), the tsdown entries, and `scripts/generate-api-surface.js`.
2. Root `tsdown.config.ts` imports source at config-load time: `src/create/scripts/*.js` and
   `src/create/utils.ts` (`dist_dir`, `mkdirp`) via the `buildCliTemplates()` `build:before` hook.
   Moving them requires updating the root config.
3. Tests use relative imports anchored at per-directory `vitest.config.ts` files
   (`src/{cli,core,create,addons,migrate}/vitest.config.ts`, wired in root `vitest.config.ts`).
   Moving config + tests together is safe; individual file moves need import updates.
4. eslint is flat config (`@sveltejs/eslint-config`, typescript-eslint, `projectService: true`).
   **No import-boundary plugin is installed** → use core `no-restricted-imports` /
   `no-restricted-syntax` with `files:` overrides in the root `eslint.config.js`.
5. Regression gate: `api-surface.md` and `api-surface-testing.md` (generated by
   `scripts/generate-api-surface.js` from the DTS-only builds into `dts-api-surface/`) must come out
   **byte-identical**.
6. `exports` map / published dist entry paths must not change; internal chunk names may renumber.

### Other findings

- `src/core/deprecated.ts` is unreachable — no importer in src or tests.
- `src/create/utils.ts` mixes runtime (`dist_dir`, `mkdirp`, `copy`, `replace`, `invalid_json`) and
  build-only helpers (`listFiles`, `saveAsset`); `pkg_root` export is dead.
- `core/package-manager.ts` mixes the interactive CLI prompt with helpers used by `testing.ts`
  (`addAllowBuildsIfPnpm`) and `workspace.ts` (`detectPackageManager`) — acceptable under one roof.
- `core/config.ts` ↔ `addons/ids.ts` is a documented type-only back-edge (cycle-breaking).
- `migrate/migrations/sveltekit-3/tasks/collect-migration-instructions.ts` has a fragile
  `../../../../core/common.ts` deep import — resolved naturally by co-locating migrate internally.
- `bin.ts` bundles nearly the entire source tree (~48 of ~50 runtime modules), which is why CLI-only
  modules must be kept importable-free from the public API surface.

## Target structure

```
packages/sv/
├── build/                          ← BUILD-TIME (tsdown hooks only)
│   ├── build-kit-template.js       ← from src/create/scripts/
│   ├── build-vite-template.js      ← from src/create/scripts/
│   ├── build-addon-template.js     ← from src/create/scripts/
│   └── fs.ts                       ← listFiles, saveAsset (own mkdirp, self-contained)
└── src/
    ├── index.ts                    # PUBLIC barrel — pure re-exports (path pinned)
    ├── testing.ts                  # DEVTIME barrel — re-exports + `declare module 'vitest'` block (path pinned)
    ├── bin.ts                      # CLI entry (path pinned, stays imperative — not a barrel)
    ├── public/                     # reachable from the published dts surface
    │   ├── engine.ts  config.ts  options.ts  workspace.ts  processors.ts
    │   ├── create/{index,templates}.ts
    │   └── addons/{index,ids,common,+14 addon modules}.ts
    └── internal/                   # everything else that runs at runtime
        ├── schemas.ts              # PackageJSONSchema, TemplateFileSchema (+ types, explicitly annotated)
        ├── cli-ui.ts               # helpConfig, runCommand, errorAndExit, cliOptions, getHelpSections, buildAndLogArgs, forwardExitCode, getPadding
        ├── project-files.ts        # updateReadme, updateLibraryBuild, updateAgent
        ├── utils.ts                # normalizePosix, isNodeError, filePaths, parseAddonOptions, runAndValidateVerifications
        ├── fs.ts                   # mkdirp, copy, replace, invalid_json, dist_dir, pkg_root (from create/utils.ts)
        ├── env.ts  errors.ts  package-manager.ts
        ├── testing.ts              # implementation behind the src/testing.ts barrel
        ├── cli/                    # add, check, create, migrate commands + fetch-packages, format-files, verifiers, project.ts, playground.ts
        └── migrate/                # entire migrate tree
```

## Boundary rules (eslint, root flat config)

1. **Entry purity** — on `packages/sv/src/index.ts` + `packages/sv/src/testing.ts`:
   `no-restricted-syntax` flagging `ExportNamedDeclaration:not([source])`
   (forbids local declarations; only `export ... from` re-exports allowed).
   Note: `declare module 'vitest'` in `testing.ts` is a `TSModuleDeclaration`, not an
   `ExportNamedDeclaration`, so the ambient augmentation is unaffected.
2. **Public → down** — on `packages/sv/src/public/**`: `no-restricted-imports` forbidding
   `**/internal/cli/**`, `**/internal/migrate/**`, `**/build/**`
   (CLI/build code can never leak into the published dts).
3. **Build isolation** — on `packages/sv/build/**`: `no-restricted-imports` forbidding
   `**/src/public/**`, `**/src/internal/cli/**`, `**/src/internal/migrate/**`.
   Type-only JSDoc `@import { TemplateFile } from '../src/internal/schemas.ts'` remains — it is erased.

Allowed direction worth stating explicitly: `src/public/**` **may** import `src/internal/**`
(the public facade sits on top of internals); only the reverse edges above are forbidden.

## Execution order

1. `git mv` public-backing modules into `src/public/` (engine, config, options, workspace,
   processors, create/{index,templates}, addons tree minus `playground.ts`).
2. `git mv` the rest into `src/internal/` (cli commands, fetch-packages, formatFiles, verifiers,
   create/project → `internal/cli/`, playground.ts → `internal/cli/`, env, errors,
   package-manager, migrate tree, create/utils.ts → `internal/fs.ts`).
3. Split `core/common.ts` into `internal/{schemas,cli-ui,project-files,utils}.ts`; convert the four
   `import * as common` sites to named imports; delete `common.ts`; update `core/tests/common.ts`.
   Give exported schema consts explicit valibot type annotations (belt-and-braces against TS9010).
4. Move scripts to `packages/sv/build/`, split build-only helpers out of `create/utils.ts`,
   update `tsdown.config.ts` imports, `packages/sv/tsconfig.json` include, oxfmt/eslint ignore globs,
   root `vitest.config.ts` project paths, and all affected relative imports (incl. tests and the
   scripts' JSDoc `@import`s).
5. Make `index.ts`/`testing.ts` pure barrels (`testing.ts` implementation → `internal/testing.ts`,
   keep the `declare module 'vitest'` augmentation in the entry).
6. Delete unreachable `core/deprecated.ts`.
7. Add the three eslint guards above.
8. Verify: `pnpm check` (tsgo), `pnpm lint`, `pnpm build` + byte-diff the two `api-surface*.md`
   snapshots (must be unchanged), `pnpm test` (at minimum the non-addon projects).

## Risks / notes

- Largest risk is mechanical: ~40 file moves with relative-import rewrites on Windows. Use `git mv`
  and do the move + import rewrite per directory, running `pnpm check` after each step.
- `playground.ts` is not part of `officialAddons`; it is CLI-only (`validatePlaygroundUrl`,
  `preparePlayground`) and moves with the CLI.
- `testing.ts`'s vitest/playwright type dependencies bleed into its published dts deliberately
  (`neverBundle` keeps the bundle small); unchanged by this plan.
- `pkg_root` dead export in `create/utils.ts` gets dropped during the split.
