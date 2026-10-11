import fs from 'node:fs';
import path from 'node:path';
import { isNodeError } from '../core/common.ts';

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

export function copy(
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
 * Copy a single asset file verbatim into an `assets` output dir, prefixing
 * leading-dot names with `DOT-` so dotfiles survive publishing. Runtime
 * renames them back via `copy()`. Shared by template and addon builds so all
 * three emit assets with the same logic.
 */
export function copyAsset({
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

export function dist(currentPath: string): string {
	// we need to make this check, because vitest is making the package root the cwd,
	// but executing the cli from the command line already makes the dist folder the cwd.
	const insideDistFolder = import.meta.url.includes('dist');

	return path.resolve(import.meta.dirname, insideDistFolder ? '' : 'dist', currentPath);
}
