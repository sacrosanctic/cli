import path from 'node:path';
import process from 'node:process';

/*
 * Strongly typed file paths: untyped input - from CLI arguments, config
 * files, the OS - is converted once at the boundaries, by the `rooted_*`
 * constructors or in place by `resolve`/`join`, and is normalized in the
 * same step. Downstream code can rely on the invariants and never needs to
 * re-normalize.
 *
 * The public surface shadows the `node:path` members the codebase uses, with
 * the same names and export kinds. Strictness follows the role:
 * - anchors are always typed values (`RootedDirectoryPath` & co.);
 * - the trailing segments of `resolve`/`join` are boundary input: loose
 *   strings (and `RelativePath`s) are accepted and validated in place, so
 *   the results honor the invariants regardless;
 * - `relative_path` stays module-private: only `relative()` derives
 *   `RelativePath`s (from rooted ones), which is why `relative_path` can
 *   enforce the stricter workspace rules. The test suite reaches it through
 *   `test_internals`, solely to assert its guards directly.
 *
 * Consumers import the module as a whole, mirroring `node:path`:
 *
 * 	import path from './path.ts';
 *
 * so `path.resolve(...)`, `path.join(...)` & co. work unchanged, with
 * `path.rooted_*`, `path.relative` and `path.to_posix` for boundary
 * conversions and normalization.
 */

declare const brand: unique symbol;

/**
 * Brand implementation using nested boolean markers so that brands *stack*
 * through intersections instead of collapsing to `never`:
 *
 * 	string & Brand<'A'> & Brand<'B'> => { [brand]: { A: true, B: true } }
 *
 * With a flat `{ [brand]: 'A' }` marker, intersecting two brands would
 * instead intersect `'A'` with `'B'` into `never`, making the stacked path
 * types uninhabitable. The payload (e.g. `string`) is intersected at every
 * use site, never inside `Brand` itself.
 */
type Brand<Name extends string> = { [brand]: { [K in Name]: true } };

/**
 * An absolute path on the host OS. Guaranteed to be normalized:
 * - rooted (starts at the filesystem root or drive letter)
 * - platform separators, no redundant `.` or `..` segments
 * - no trailing separator (unless the path is a root itself, e.g. `/` or `C:\`)
 */
export type RootedPath = string & Brand<'RootedPath'>;

/**
 * A `RootedPath` that is intended to point at a file. Intent is not verifiable
 * by spelling alone: `rooted_file` asserts exactly what `rooted_path` does, so
 * where it matters, an on-disk check confirms it.
 */
export type RootedFilePath = RootedPath & Brand<'RootedFilePath'>;

/**
 * A `RootedPath` that is intended to point at a directory. Intent is not
 * verifiable by spelling alone: `rooted_dir` asserts exactly what
 * `rooted_path` does, so where it matters, an on-disk check confirms it.
 */
export type RootedDirectoryPath = RootedPath & Brand<'RootedDirectoryPath'>;

/**
 * A posix-spelled relative path, normalized:
 * - relative (no leading `/`, no drive or device prefix)
 * - no redundant `.` segments and no trailing `/`
 * - `.` denotes the base itself (only `relative` can produce it), while `..`
 *   chains are meaningful escapes out of a base directory (likewise only
 *   from `relative`; workspace-relative boundaries never spell either)
 */
export type RelativePath = string & Brand<'RelativePath'>;

// ---------------------------------------------------------------------------
// normalizers
// ---------------------------------------------------------------------------

/**
 * The root of an already slash-swapped path: a device-prefixed drive
 * (`//?/C:/`), a drive (`C:/`), or a slash root (`//` or `/`).
 */
const RX_SLASHED_ROOT = /^(\/\/\?\/[A-Za-z]:\/|[A-Za-z]:\/|\/\/|\/)/;

/**
 * Converts any path spelling into the project's posix normal form:
 * separators are swapped to `/`, redundant `.`/`..` segments are resolved, or
 * absorbed while spelling `/`, and trailing separators are removed - except
 * where the separator *is* the root itself (`C:/`, `/`). Works on both rooted
 * and relative input, and a drive-relative spelling (`C:`, `C:work`) passes
 * through as-is: no portable normal form exists for it, so the validators
 * reject it instead. Not a validator: it normalizes, it never throws.
 */
export function to_posix(value: string): string {
	const slashed = value.replace(/\\/g, '/');
	// `.normalize` must not see the root: it would drop a drive's trailing `/`
	// (e.g. `C:/` -> `C:`), breaking the round-trip. Normalize only the
	// remaining relative part, which resolves interior `.`/`..` segments.
	const [, root = ''] = slashed.match(RX_SLASHED_ROOT) ?? [];
	const rest = slashed.slice(root.length).replace(/\/+$/, '');
	// `posix.normalize('')` would yield `.` - `posix.normalize` is skipped on empty
	const relative = rest === '' ? '' : path.posix.normalize(rest);
	return root + relative;
}

// ---------------------------------------------------------------------------
// boundary constructors
// ---------------------------------------------------------------------------

/**
 * The one error shape for every guard; `kind` selects the prefix
 * (`Invalid path: …` / `Invalid segment: …`).
 */
function invalid(kind: 'path' | 'segment', value: string, reason: string): never {
	throw new Error(`Invalid ${kind}: unable to treat '${value}' as ${reason}`);
}

/**
 * Rejects a relative request whose locations share no root (e.g. two
 * different Windows drives): `node:path.relative` furnishes no relative
 * spelling for them, only a misleading `''` or the unchecked `to` spelling.
 * It gets its own error instead of the shared shape: the failure is about the
 * *pair* of inputs, not one invalid value.
 */
function no_shared_root(from: string, to: string): never {
	throw new Error(
		`Invalid relative request: no relative spelling from '${from}' to '${to}' - the two locations share no root`
	);
}

/**
 * A Windows drive-relative spelling: `C:` or `C:work` - a drive prefix
 * without a root. Per MSDN these denote paths relative to the per-drive
 * working directory; they are neither rooted nor relative, so they have no
 * portable meaning and every relative context rejects them.
 */
const RX_DRIVE_RELATIVE = /^[A-Za-z]:($|[^\\/])/;

/**
 * Scans a slash-swapped path for a drive-relative fragment (a component
 * matching `RX_DRIVE_RELATIVE`), returning the first one or `null` if clean.
 * Applied to each segment's `to_posix` normal form, so evasive spellings
 * cannot hide a fragment: `./C:work` and `src/../C:work` normalize into a
 * leading one, `src\\C:work` surfaces as an interior one.
 */
function drive_relative_fragment(posix: string): string | null {
	// the root (`C:/`, `//?/C:/`, `/`) is not a fragment: slice it off first so
	// its drive letter is not scanned, then inspect every component
	const [, root = ''] = posix.match(RX_SLASHED_ROOT) ?? [];
	for (const component of posix.slice(root.length).split('/')) {
		if (RX_DRIVE_RELATIVE.test(component)) return component;
	}
	return null;
}

/**
 * Shape validation shared by all relative path producers. `posix` must be
 * `original` after `to_posix`: non-empty, and relative for *every* platform's
 * spelling - `win32.isAbsolute` catches rooted drive spellings like `C:/work`
 * on any host, and a drive-relative fragment (`C:work`, or an interior one
 * like `src/C:work`) is caught however it is spelled.
 */
function validate_slashed_relative(original: string, posix: string): void {
	if (posix === '') invalid('path', original, 'a non-empty relative path');
	if (path.win32.isAbsolute(posix) || path.posix.isAbsolute(posix)) {
		invalid('path', original, 'a relative path');
	}
	const fragment = drive_relative_fragment(posix);
	if (fragment) {
		invalid(
			'path',
			original,
			`a relative path without the drive-relative fragment '${fragment}' - drive-relative spellings are neither rooted nor relative`
		);
	}
}

/**
 * Removes any trailing separator without touching the root.
 */
function strip_trailing_separators(value: string): string {
	const root = path.parse(value).root;
	const without_root = value.slice(root.length);
	return root + without_root.replace(/[\\/]+$/, '');
}

/**
 * Validates that `value` is absolute and returns it in normalized rooted form.
 */
function normalize_rooted(value: string): string {
	const normalized = strip_trailing_separators(path.normalize(value));
	// Load-bearing assertion, not a formality: how normalizers treat `..` above
	// the root has changed across Node versions (nodejs/node#18763), and a
	// result like `C:` would be drive-*relative* (relative to the per-drive
	// working directory, per MSDN) - never rooted. `RootedPath`'s guarantee
	// must not depend on the runtime's normalizer.
	if (!path.isAbsolute(normalized)) invalid('path', value, 'a rooted (absolute) path');
	return normalized;
}

/**
 * Converts an absolute path into a `RootedPath`, asserting its validity.
 * Accepts benign variations (forward-slash spellings on Windows, redundant `.` or
 * `..` segments, trailing separators) but rejects relative input.
 * @param value an absolute path, as provided by the platform (e.g. CLI, `process.cwd()`)
 */
export function rooted_path(value: string): RootedPath {
	return normalize_rooted(value) as RootedPath;
}

/**
 * Converts an absolute file path into a `RootedFilePath`, asserting its validity.
 */
export function rooted_file(value: string): RootedFilePath {
	return rooted_path(value) as RootedFilePath;
}

/**
 * Converts an absolute directory path into a `RootedDirectoryPath`, asserting its validity.
 */
export function rooted_dir(value: string): RootedDirectoryPath {
	return rooted_path(value) as RootedDirectoryPath;
}

/**
 * Converts a workspace-relative path into a `RelativePath`, asserting its validity.
 * Module-private: downstream never brands relative input itself, `resolve`/`join`
 * convert loose segments in place and `relative()` derives `RelativePath`s from
 * rooted ones.
 * Accepts benign variations (backslashes on Windows, redundant `.` or `..`
 * segments, trailing separators) but rejects absolute input, the nebulous `.`,
 * `..` escapes out of the workspace, and Windows drive spellings (`C:/work`,
 * and also the rootless `C:work`, which is neither rooted nor relative).
 * @param value a relative path, as provided by the boundary (e.g. config files)
 */
function relative_path(value: string): RelativePath {
	const posix = to_posix(value);
	validate_slashed_relative(value, posix);
	if (posix === '.') invalid('path', value, 'a relative path that points at an entry, not `.`');
	if (posix === '..' || posix.startsWith('../')) {
		invalid('path', value, 'a relative path without `..` escapes out of the workspace');
	}
	return posix as RelativePath;
}

/** Returns the process's current working directory, rooted. */
export function cwd(): RootedDirectoryPath {
	return rooted_dir(process.cwd());
}

/**
 * Same as `node:path.relative`, but typed and posix-normalized. A `..` chain
 * escaping out of the base is a legitimate result here, and `to === from`
 * yields the canonical `.`. Throws when the two locations share no root
 * (e.g. different Windows drives): there is no relative spelling between them.
 * @param from the rooted directory `to` is relative to
 * @param to the rooted path to relativize
 */
export function relative(from: RootedDirectoryPath, to: RootedPath): RelativePath {
	const posix = to_posix(path.relative(from, to));
	// `node:path.relative` spells "same location" as `''`; `.` is
	// `RelativePath`'s canonical sentinel for it. Locations that share no root
	// - e.g. two different Windows drives - have no relative spelling: node
	// versions hand back either `''` or the unchecked (absolute) `to` spelling,
	// and since `from !== to` here, neither can be the "same location" sentinel.
	if (posix === '' || posix === '.') {
		if (from !== to) no_shared_root(from, to);
		return '.' as RelativePath;
	}
	if (path.win32.isAbsolute(posix) || path.posix.isAbsolute(posix)) {
		// current node hands back the unchecked `to` spelling when the
		// locations share no root; treat it like the `''` case above
		no_shared_root(from, to);
	}
	validate_slashed_relative(`${from} -> ${to}`, posix);
	return posix as RelativePath;
}

// ---------------------------------------------------------------------------
// node:path shadows (anchor typed; loose trailing segments validated in place)
// ---------------------------------------------------------------------------

/**
 * Windows drive-relative segments are neither rooted nor relative, however
 * they are spelled (`C:`, `C:work`, `./C:work`, `src/../C:work`,
 * `src\\C:work`): `node:path.resolve` would silently anchor them at the
 * per-drive working directory or drop the fragment, so `resolve` must reject
 * them.
 */
function resolve_segment_guard(segment: string): void {
	const fragment = drive_relative_fragment(to_posix(segment));
	if (fragment) {
		invalid(
			'segment',
			segment,
			`a relative or rooted segment without the drive-relative fragment '${fragment}' - node would silently anchor at the per-drive cwd`
		);
	}
}

/**
 * Like `resolve`, but stricter: `node:path.join`, unlike `resolve`, does not
 * rebase - a rooted segment would merely be concatenated (`C:\work\project` +
 * `C:\elsewhere` => `C:\work\project\C:\elsewhere`), so `join` rejects them.
 */
function join_segment_guard(segment: string): void {
	const posix = to_posix(segment);
	const fragment = drive_relative_fragment(posix);
	if (fragment) {
		invalid(
			'segment',
			segment,
			`a relative segment without the drive-relative fragment '${fragment}' - drive-relative input is neither rooted nor relative (pass a rooted spelling to \`resolve\`, which rebases)`
		);
	}
	// rooted input, in any spelling (`/x`, `C:/x`, `//?/C:/x`): a drive root in
	// this position is only okay for `resolve`, which rebases onto it
	if (RX_SLASHED_ROOT.test(posix)) {
		invalid(
			'segment',
			segment,
			'a relative segment - rooted input belongs to `resolve` (which rebases), `join` would concatenate it into a malformed path'
		);
	}
}

/**
 * Resolves `segments` relative to the anchored `dir` to an absolute, normalized
 * path. An absolute segment rebases the result onto its own root, matching
 * `node:path` semantics - the result is always rooted.
 */
export function resolve(
	dir: RootedDirectoryPath,
	...segments: Array<string | RelativePath>
): RootedPath {
	for (const segment of segments) resolve_segment_guard(segment);
	return strip_trailing_separators(path.resolve(dir, ...segments)) as RootedPath;
}

/**
 * Joins `segments` onto the anchored `dir`, keeping the anchor's rooted
 * invariants: `.`/`..` segments resolve, trailing separators are stripped.
 * Replacing an absolute segment does not rebase - that is `resolve`'s job,
 * and `join` rejects rooted input rather than malforming the result.
 */
export function join(
	dir: RootedDirectoryPath,
	...segments: Array<string | RelativePath>
): RootedPath {
	for (const segment of segments) join_segment_guard(segment);
	return strip_trailing_separators(path.join(dir, ...segments)) as RootedPath;
}

/** Returns the parent directory of a rooted path. */
export function dirname(p: RootedPath): RootedDirectoryPath {
	return path.dirname(p) as RootedDirectoryPath;
}

/** Returns the last segment of a rooted path, with `ext` removed when provided. */
export function basename(p: RootedPath, ext?: string): string {
	return path.basename(p, ext);
}

/**
 * Checks if a path matches a glob pattern.
 *
 * `node:path.matchesGlob` compares the entire input against the pattern, so
 * the pattern must cover the whole path, separators included:
 * - a `RelativePath` is the ergonomic case: the pattern spells posix `/`;
 * - a `RootedPath` needs a rooted (full-path) pattern spelled in the
 *   platform's separators (`**\src\*.ts` on Windows). Prefer matching
 *   `RelativePath`s: a platform-spelled rooted pattern is brittle.
 */
export function matchesGlob(p: RelativePath | RootedPath, pattern: string): boolean {
	return path.matchesGlob(p, pattern);
}

// ---------------------------------------------------------------------------
// test-only surface
// ---------------------------------------------------------------------------

/**
 * Internals exposed only so the test suite can assert their guards directly.
 * Deliberately not part of the public API: only here, and only in this object -
 * anything for downstream use goes to the default export.
 * @internal
 */
export const test_internals = { relative_path };

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

export default {
	// boundary conversions (untyped -> typed) & the normalizer
	rooted_path,
	rooted_file,
	rooted_dir,
	to_posix,

	// typed variants of `node:path`
	resolve,
	join,
	dirname,
	basename,
	relative,
	matchesGlob,

	// convenience util
	cwd
};
