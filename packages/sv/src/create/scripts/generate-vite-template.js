import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveAsset, listFiles, mkdirp, isBinaryFile } from '../utils.ts';

/** @import { LanguageType } from '../index.ts' */
/** @import { TemplateFile } from '../../core/common.ts' */

const create_vite_path = path.dirname(
	fileURLToPath(import.meta.resolve('create-vite/package.json'))
);

/**
 * Generates the 'svelte' template (vite-only, no SvelteKit) from create-vite bundled templates.
 * This template is internal-only and not shown in CLI prompts.
 * @param {string} dist_dir
 */
export function generate_vite_manifest(dist_dir) {
	const Target_path = path.join(dist_dir, 'templates', 'svelte');
	const assets = path.join(Target_path, 'assets');
	mkdirp(Target_path);

	/** @type {Record<LanguageType, TemplateFile[]>} */
	const types = {
		typescript: [],
		checkjs: [], // not used for vite template
		none: []
	};

	/** @type {TemplateFile[]} */
	const shared = [];

	// Process both JS and TS variants
	/** @type {{ src: string; lang: LanguageType }[]} */
	const variants = [
		{ src: 'template-svelte', lang: 'none' },
		{ src: 'template-svelte-ts', lang: 'typescript' }
	];

	for (const { src, lang } of variants) {
		const source_path = path.join(create_vite_path, src);

		for (const name of listFiles(source_path)) {
			const file_path = path.join(source_path, name);

			// create-vite replaces '_' with '.' in template file names because npm strips leading dots on publish
			if (name === '_gitignore') {
				if (lang === 'none')
					shared.push({ name: '.gitignore', contents: fs.readFileSync(file_path, 'utf8') });
				continue;
			}

			if (isBinaryFile(file_path)) {
				if (lang === 'none') saveAsset({ from: file_path, assetsDir: assets, name });
				continue;
			}

			const contents = fs.readFileSync(file_path, 'utf8');

			if (name === 'jsconfig.json' && lang === 'typescript') continue;
			if (name === 'tsconfig.json' && lang === 'none') continue;

			types[lang].push({ name, contents });
		}
	}

	// identical files across every used language variant belong in
	// `files.shared.json` instead of being duplicated per variant
	const variant_langs = /** @type {LanguageType[]} */ (['typescript', 'none']);
	for (const name of new Set([...types.typescript, ...types.none].map((file) => file.name))) {
		const entries = variant_langs.map((lang) => types[lang].find((file) => file.name === name));
		const contents = entries[0]?.contents;
		if (contents === undefined || !entries.every((entry) => entry?.contents === contents)) continue;
		shared.push({ name, contents });
		for (const lang of variant_langs) {
			types[lang] = types[lang].filter((file) => file.name !== name);
		}
	}

	// Write meta.json (internal template, minimal metadata)
	fs.writeFileSync(
		path.join(Target_path, 'meta.json'),
		JSON.stringify(
			{ title: 'Svelte', description: 'Vite + Svelte template (internal)' },
			null,
			'\t'
		)
	);

	if (shared.length > 0) {
		fs.writeFileSync(
			path.join(Target_path, 'files.shared.json'),
			JSON.stringify(shared, null, '\t')
		);
	}

	// Write files for each language type
	fs.writeFileSync(
		path.join(Target_path, 'files.types=typescript.json'),
		JSON.stringify(types.typescript, null, '\t')
	);
	fs.writeFileSync(
		path.join(Target_path, 'files.types=checkjs.json'),
		JSON.stringify([], null, '\t') // empty, not supported for vite template
	);
	fs.writeFileSync(
		path.join(Target_path, 'files.types=none.json'),
		JSON.stringify(types.none, null, '\t')
	);
}
