import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as walk from 'empathic/walk';
import * as v from 'valibot';
import { isNodeError } from '../core/common.ts';

/**
 * directory containing `package.json` — works whether the code is run from
 * source, bundled into `dist/`, or consumed from `node_modules` by a template
 */
const find_sv_root = (): string => {
	const rootDir = walk
		.up(path.dirname(fileURLToPath(import.meta.url)))
		.find((currentDir) => fs.existsSync(path.join(currentDir, 'package.json')));

	if (!rootDir) throw new Error('Could not locate package.json');
	return rootDir;
};

/**
 * absolute path to the `dist` directory
 * containing templates, add-ons and shared files
 *
 * can be used during runtime or devtime
 */
export const dist_dir = path.join(find_sv_root(), 'dist');

export function mkdirp(dir: string): void {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (err) {
		if (isNodeError(err) && err.code === 'EEXIST') return;
		throw err;
	}
}

function identity<T>(x: T): T {
	return x;
}

export function replace(contents: string, kv: Record<string, string>): string {
	for (const [key, value] of Object.entries(kv)) {
		contents = contents.replaceAll(key, value);
	}
	return contents;
}

export function copy(
	from: string,
	to: string,
	rename: (basename: string) => string = identity
): void {
	if (!fs.existsSync(from)) return;
	if (fs.statSync(from).isFile()) {
		mkdirp(path.dirname(to));
		fs.copyFileSync(from, to);
		return;
	}

	fs.readdirSync(from).forEach((file) => {
		copy(path.join(from, file), path.join(to, rename(file)), rename);
	});
}

export function listFiles(cwd: string): string[] {
	return fs
		.readdirSync(cwd, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map(({ parentPath, name }) =>
			path.posix.join(path.relative(cwd, parentPath).replaceAll(path.sep, '/'), name)
		)
		.sort();
}

const BINARY_EXTENSION = new Set(['.png']);
const TEXT_EXTENSION = new Set([
	'.css',
	'.html',
	'.js',
	'.json',
	'.md',
	'.svelte',
	'.svg',
	'.ts',
	'.txt',
	'.yml'
]);
const TEXT_EXTENSIONLESS = new Set(['.gitignore']);
export function isBinaryFile(file_path: string): boolean {
	const extension = path.extname(file_path).toLowerCase();
	if (BINARY_EXTENSION.has(extension)) return true;
	if (TEXT_EXTENSION.has(extension)) return false;
	if (TEXT_EXTENSIONLESS.has(path.basename(file_path).toLowerCase())) return false;

	// not in any list — sniff the content to decide
	const buffer = fs.readFileSync(file_path);
	// a NUL byte never appears in utf8 text; utf16 also starts with one
	let text = !buffer.includes(0);
	if (text) {
		// invalid utf8 is not expected for text files, so treat it as binary
		try {
			new TextDecoder('utf-8', { fatal: true }).decode(buffer);
		} catch {
			text = false;
		}
	}

	console.warn(
		`${path.basename(file_path)} was sniffed. If performance is degraded, consider adding it to a list in ${import.meta.dirname}.`
	);

	return !text;
}

/**
 * Save a single asset file verbatim into an `assets` output dir, prefixing
 * leading-dot names with `DOT-` so dotfiles survive publishing. Runtime
 * renames them back via `fetchAssets()`. Shared by template and addon builds so all
 * three emit assets with the same logic.
 */
export function saveAsset({
	from,
	assetsDir,
	name
}: {
	from: string;
	assetsDir: string;
	name: string;
}): string {
	const dest = path.join(assetsDir, name.replace(/^\./, 'DOT-'));
	mkdirp(path.dirname(dest));
	fs.copyFileSync(from, dest);
	return dest;
}

type NonEmptyArray<T> = [T, ...T[]];
export function invalid_json(file_path: string, issues: NonEmptyArray<v.GenericIssue>): Error {
	const error = [
		`invalid JSON in ${file_path}:`,
		issues.map((issue) => (issue.path ? `${v.getDotPath(issue)}: ${issue.message}` : issue.message))
	].join('\n');

	return new Error(error);
}
