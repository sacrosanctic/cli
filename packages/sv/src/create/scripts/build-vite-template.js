import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveAsset, listFiles, mkdirp } from '../utils.ts';

/** @import { File, LanguageType } from '../index.ts' */

/**
 * Generates the 'svelte' template (vite-only, no SvelteKit) from create-vite bundled templates.
 * This template is internal-only and not shown in CLI prompts.
 * @param {string} dist
 */
export function build_vite_template(dist) {
	const dir = path.join(dist, 'templates', 'svelte');
	const assets = path.join(dir, 'assets');
	mkdirp(assets);

	/** @type {Record<LanguageType, File[]>} */
	const types = {
		typescript: [],
		checkjs: [], // not used for vite template
		none: []
	};

	/** @type {File[]} */
	const shared = [];

	// Process both JS and TS variants
	const variants = /** @type {const} */ ([
		{ src: 'template-svelte', lang: /** @type {LanguageType} */ ('none') },
		{ src: 'template-svelte-ts', lang: /** @type {LanguageType} */ ('typescript') }
	]);

	for (const { src, lang } of variants) {
		const createVitePackageJson = fileURLToPath(import.meta.resolve('create-vite/package.json'));
		const createVitePath = path.dirname(createVitePackageJson);
		const srcDir = path.join(createVitePath, src);
		const files = listFiles(srcDir);

		for (const name of files) {
			const srcPath = path.join(srcDir, name);
			const contents = fs.readFileSync(srcPath, 'utf8');

			// create-vite templates keep the `_gitignore` convention; embed it as
			// the user-facing `.gitignore` in `files.shared.json` so npm
			// publication can't strip it (no `DOT-` workaround needed)
			if (name === '_gitignore' && lang === 'none') {
				shared.push({ name: '.gitignore', contents });
				continue;
			}
			if (name === '_gitignore') continue;

			// Binary/asset files go to assets folder (only process once for 'none' variant)
			if (lang === 'none' && !/\.(js|ts|svelte|json|html|css|md)$/i.test(name)) {
				saveAsset({ from: srcPath, assetsDir: assets, name });
				continue;
			}

			// Text files go to files.types=*.json
			if (/\.(js|ts|svelte|json|html|css)$/i.test(name)) {
				// Skip jsconfig.json for TS variant, skip tsconfig.json for JS variant
				if (name === 'jsconfig.json' && lang === 'typescript') continue;
				if (name === 'tsconfig.json' && lang === 'none') continue;

				types[lang].push({ name, contents });
			}
		}
	}

	// identical files across every used language variant belong in
	// `files.shared.json` instead of being duplicated per variant
	const variantLangs = /** @type {LanguageType[]} */ (['typescript', 'none']);
	for (const name of new Set(
		[...types.typescript, ...types.none].map((file) => file.name)
	)) {
		const entries = variantLangs.map((lang) => types[lang].find((file) => file.name === name));
		const contents = entries[0]?.contents;
		if (!entries.every((entry) => entry?.contents === contents)) continue;
		shared.push({ name, contents });
		for (const lang of variantLangs) {
			types[lang] = types[lang].filter((file) => file.name !== name);
		}
	}

	// Write meta.json (internal template, minimal metadata)
	fs.writeFileSync(
		path.join(dir, 'meta.json'),
		JSON.stringify(
			{ title: 'Svelte', description: 'Vite + Svelte template (internal)' },
			null,
			'\t'
		)
	);

	if (shared.length > 0) {
		fs.writeFileSync(path.join(dir, 'files.shared.json'), JSON.stringify(shared, null, '\t'));
	}

	// Write files for each language type
	fs.writeFileSync(
		path.join(dir, 'files.types=typescript.json'),
		JSON.stringify(types.typescript, null, '\t')
	);
	fs.writeFileSync(
		path.join(dir, 'files.types=checkjs.json'),
		JSON.stringify([], null, '\t') // empty, not supported for vite template
	);
	fs.writeFileSync(path.join(dir, 'files.types=none.json'), JSON.stringify(types.none, null, '\t'));
}
