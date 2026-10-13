import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as walk from 'empathic/walk';
import { transform } from 'sucrase';
import * as v from 'valibot';
import { isNodeError } from '../core/common.ts';

// directory containing `package.json` — works whether the code is run from
// source, bundled into `dist/`, or consumed from `node_modules` by a template
export const pkg_root = (() => {
	const dir = walk
		.up(path.dirname(fileURLToPath(import.meta.url)))
		.find((dir) => fs.existsSync(path.join(dir, 'package.json')));
	if (!dir) throw new Error('could not locate package.json');
	return dir;
})();

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

export function kv(name: string): Record<string, string> {
	const protocolName = name.startsWith('@') ? name.split('/')[0] : name;
	return {
		'$SV-PROTOCOL-NAME-TODO$': protocolName,
		'$SV-NAME-TODO$': name
	};
}

// files that have kv's in the contents that we replace
const withReplaceExtensions = ['.md', '.js', '.ts', '.json'];

function copy(
	from: string,
	to: string,
	rename: (basename: string) => string = identity,
	kv: Record<string, string> = {}
): void {
	if (!fs.existsSync(from)) return;
	const stats = fs.statSync(from);

	if (stats.isDirectory()) {
		fs.readdirSync(from).forEach((file) => {
			copy(path.join(from, file), path.join(to, rename(file)), rename, kv);
		});
	} else {
		mkdirp(path.dirname(to));
		if (withReplaceExtensions.some((ext) => from.endsWith(ext))) {
			fs.writeFileSync(to, replace(fs.readFileSync(from, 'utf-8'), kv));
		} else {
			fs.copyFileSync(from, to);
		}
	}
}

/**
 * List all files under `cwd` (recursive) as sorted paths relative to `cwd`.
 * Shared by the build scripts (`build-kit-template.js`, `build-addon-content.js`)
 * so templates, the vite template, and addons enumerate source files identically.
 */
export function listFiles(cwd: string): string[] {
	return fs
		.readdirSync(cwd, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map(({ parentPath, name }) => path.join(path.relative(cwd, parentPath), name))
		.sort();
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
	name,
	destName
}: {
	from: string;
	assetsDir: string;
	name: string;
	destName?: string;
}): string {
	const dest = path.join(assetsDir, (destName ?? name).replace(/^\./, 'DOT-'));
	mkdirp(path.dirname(dest));
	fs.copyFileSync(from, dest);
	return dest;
}

export function fetchAssets(from: string, to: string, name: string): void {
	copy(from, to, (file: string) => file.replace('DOT-', '.'), kv(name));
}

export function strip_typescript(content: string) {
	const { code } = transform(content, {
		transforms: ['typescript'],
		disableESTransforms: true
	});

	const result = code
		// sucrase leaves invalid class fields intact
		.replace(/^\s*[a-z]+;$/gm, '')
		// Replace "local import" that ends with ".ts" to ".js"
		.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"');

	return result;
}

export function strip_jsdoc(content: string) {
	return content
		.replace(/ \/\*\*\*\//g, '')
		.replace(
			/\/\*\*([\s\S]+?)(@[\s\S]+?)?\*\/([\s\n]+)/g,
			(match, description, tags, whitespace) => {
				if (/^\s+(\*\s*)?$/.test(description)) {
					return '';
				}

				return `/**${description.replace(/\* $/, '')}*/${whitespace}`;
			}
		);
}

type NonEmptyArray<T> = [T, ...T[]];
export function invalid_json(file_path: string, issues: NonEmptyArray<v.GenericIssue>): Error {
	const error = [
		`invalid JSON in ${file_path}:`,
		issues.map((issue) => (issue.path ? `${v.getDotPath(issue)}: ${issue.message}` : issue.message))
	].join('\n');

	return new Error(error);
}
