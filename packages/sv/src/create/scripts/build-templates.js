// @ts-check
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from 'gitignore-parser';
import { format } from 'oxfmt';
import { transform } from 'sucrase';
import glob from 'tiny-glob/sync.js';
import oxfmtConfig from '../../../../../oxfmt.config.ts';

/** @import { File, LanguageType } from '../index.ts' */

const pkgRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const require = createRequire(import.meta.url);
const createVitePath = path.dirname(require.resolve('create-vite/package.json'));

/** @param {string} content */
async function convert_typescript(content) {
	let { code } = transform(content, {
		transforms: ['typescript'],
		disableESTransforms: true
	});

	// sucrase leaves invalid class fields intact
	code = code.replace(/^\s*[a-z]+;$/gm, '');

	// Replace "local import" that ends with ".ts" to ".js"
	code = code.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"');

	const result = await format('file.js', code, oxfmtConfig);

	return result.code;
}

/** @param {string} content */
function strip_jsdoc(content) {
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

/**
 * @param {string} dist
 */
async function generate_templates(dist) {
	const templates = fs.readdirSync(path.resolve(pkgRoot, 'templates'));

	for (const template of templates) {
		if (template[0] === '.') continue;

		const dir = path.join(dist, 'templates', template);
		const assets = path.join(dir, 'assets');
		mkdirp(assets);

		const cwd = path.resolve(pkgRoot, 'templates', template);

		const gitignore_file = path.join(cwd, '.gitignore');
		if (!fs.existsSync(gitignore_file)) {
			throw new Error(`"${template}" template must have a .gitignore file`);
		}

		const gitignore = parser.compile(fs.readFileSync(gitignore_file, 'utf-8'));

		const ignore_file = path.join(cwd, '.ignore');
		if (!fs.existsSync(ignore_file)) throw new Error('Template must have a .ignore file');
		const ignore = parser.compile(fs.readFileSync(ignore_file, 'utf-8'));

		const meta_file = path.join(cwd, '.meta.json');
		if (!fs.existsSync(meta_file)) throw new Error('Template must have a .meta.json file');

		/** @type {Record<LanguageType, File[]>} */
		const types = {
			typescript: [],
			checkjs: [],
			none: []
		};

		// normalize to forward slashes so generated manifests are identical across platforms
		const files = glob('**/*', { cwd, filesOnly: true, dot: true }).map((name) =>
			name.replaceAll('\\', '/')
		);
		for (const name of files) {
			// the package.template.json thing is a bit annoying — basically we want
			// to be able to develop and deploy the app from here, but have a different
			// package.json in newly created projects (based on package.template.json)
			if (name === 'package.template.json') {
				const packagesDir = path.resolve(pkgRoot, '..', '..', '..');
				const getVersion = (/** @type {string} */ pkgDir) => {
					const pkgPath = path.join(packagesDir, pkgDir, 'package.json');
					return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
				};
				const replaceWorkspace = (
					/** @type {string} */ str,
					/** @type {string} */ key,
					/** @type {string} */ version
				) => {
					return str.replaceAll(`"${key}": "workspace:*"`, `"${key}": "^${version}"`);
				};

				let contents = fs.readFileSync(path.join(cwd, name), 'utf8');
				contents = replaceWorkspace(contents, 'sv', getVersion('sv'));
				contents = replaceWorkspace(contents, '@sveltejs/sv-utils', getVersion('sv-utils'));

				fs.writeFileSync(path.join(dir, 'package.json'), contents);
				continue;
			}

			// ignore contents of .gitignore or .ignore
			if (!gitignore.accepts(name) || !ignore.accepts(name) || name === '.ignore') continue;

			if (/\.(ts|svelte)$/.test(name)) {
				const contents = fs.readFileSync(path.join(cwd, name), 'utf8');

				if (name.endsWith('.d.ts')) {
					if (name.endsWith('app.d.ts')) types.checkjs.push({ name, contents });
					types.typescript.push({ name, contents });
				} else if (name.endsWith('.ts')) {
					const js = await convert_typescript(contents);

					types.typescript.push({
						name,
						contents: strip_jsdoc(contents)
					});

					types.checkjs.push({
						name: name.replace(/\.ts$/, '.js'),
						contents: js
					});

					types.none.push({
						name: name.replace(/\.ts$/, '.js'),
						contents: strip_jsdoc(js)
					});
				} else {
					// we jump through some hoops, rather than just using svelte.preprocess,
					// so that the output preserves the original formatting to the extent
					// possible (e.g. preserving double line breaks). Sucrase is the best
					// tool for the job because it just removes the types; Prettier then
					// tidies up the end result
					const js_contents = await replace_async(
						contents,
						/<script([^>]+)>([\s\S]+?)<\/script>/g,
						async (
							/** @type {any} */ m,
							/** @type {string} */ attrs,
							/** @type {string} */ typescript
						) => {
							// Sucrase assumes 'unused' imports (which _are_ used, but only
							// in the markup) are type imports, and strips them. This step
							// prevents it from drawing that conclusion
							const imports = [];
							const import_pattern = /import (.+?) from/g;
							let import_match;
							while ((import_match = import_pattern.exec(typescript))) {
								const word_pattern = /[a-z_$][a-z0-9_$]*/gi;
								let word_match;
								// @ts-ignore
								while ((word_match = word_pattern.exec(import_match[1]))) {
									imports.push(word_match[0]);
								}
							}

							const suffix = `\n${imports.join(',')}`;

							const transformed = transform(typescript + suffix, {
								transforms: ['typescript'],
								disableESTransforms: true
							}).code.slice(0, -suffix.length);

							const contents = (await format('file.js', transformed, oxfmtConfig)).code
								.trim()
								.replace(/^(.)/gm, '\t$1');

							return `<script${attrs.replace(' lang="ts"', '')}>\n${contents}\n</script>`;
						}
					);

					types.typescript.push({
						name,
						contents: strip_jsdoc(contents)
					});

					types.checkjs.push({
						name,
						contents: js_contents
					});

					types.none.push({
						name,
						contents: strip_jsdoc(js_contents)
					});
				}
			} else {
				const dest = path.join(assets, name.replace(/^\./, 'DOT-'));
				mkdirp(path.dirname(dest));
				fs.copyFileSync(path.join(cwd, name), dest);
			}
		}

		fs.copyFileSync(meta_file, path.join(dir, 'meta.json'));
		fs.writeFileSync(
			path.join(dir, 'files.types=typescript.json'),
			JSON.stringify(types.typescript, null, '\t')
		);
		fs.writeFileSync(
			path.join(dir, 'files.types=checkjs.json'),
			JSON.stringify(types.checkjs, null, '\t')
		);
		fs.writeFileSync(
			path.join(dir, 'files.types=none.json'),
			JSON.stringify(types.none, null, '\t')
		);
	}
}

/**
 * @param {string} string
 * @param {RegExp} regexp
 * @param {(m: any, attrs: string, typescript: string) => Promise<string>} replacer
 */
async function replace_async(string, regexp, replacer) {
	const replacements = await Promise.all(
		// @ts-ignore
		Array.from(string.matchAll(regexp), (match) => replacer(...match))
	);
	let i = 0;
	return string.replace(regexp, () => replacements[i++]);
}

/** @param {string} dir */
export function mkdirp(dir) {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (e) {
		if (/** @type {any} */ (e).code === 'EEXIST') return;
		throw e;
	}
}

/**
 * Generates the 'svelte' template (vite-only, no SvelteKit) from create-vite bundled templates.
 * This template is internal-only and not shown in CLI prompts.
 * @param {string} dist
 */
function generate_vite_template(dist) {
	const dir = path.join(dist, 'templates', 'svelte');
	const assets = path.join(dir, 'assets');
	mkdirp(assets);

	/** @type {Record<LanguageType, File[]>} */
	const types = {
		typescript: [],
		checkjs: [], // not used for vite template
		none: []
	};

	// Process both JS and TS variants
	const variants = /** @type {const} */ ([
		{ src: 'template-svelte', lang: /** @type {LanguageType} */ ('none') },
		{ src: 'template-svelte-ts', lang: /** @type {LanguageType} */ ('typescript') }
	]);

	for (const { src, lang } of variants) {
		const srcDir = path.join(createVitePath, src);
		// normalize to forward slashes so generated manifests are identical across platforms
		const files = glob('**/*', { cwd: srcDir, filesOnly: true, dot: true }).map((name) =>
			name.replaceAll('\\', '/')
		);

		for (const name of files) {
			const srcPath = path.join(srcDir, name);
			const contents = fs.readFileSync(srcPath, 'utf8');

			// Handle _gitignore -> .gitignore rename (asset file)
			if (name === '_gitignore' && lang === 'none') {
				const dest = path.join(assets, 'DOT-gitignore');
				fs.copyFileSync(srcPath, dest);
				continue;
			}
			if (name === '_gitignore') continue;

			// Binary/asset files go to assets folder (only process once for 'none' variant)
			if (lang === 'none' && !/\.(js|ts|svelte|json|html|css|md)$/i.test(name)) {
				const dest = path.join(assets, name.replace(/^\./, 'DOT-'));
				mkdirp(path.dirname(dest));
				fs.copyFileSync(srcPath, dest);
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

	// Write meta.json (internal template, minimal metadata)
	fs.writeFileSync(
		path.join(dir, 'meta.json'),
		JSON.stringify(
			{ title: 'Svelte', description: 'Vite + Svelte template (internal)' },
			null,
			'\t'
		)
	);

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

/**
 * @param {string} dist
 */
export async function buildTemplates(dist) {
	mkdirp(dist);

	await generate_templates(dist);
	generate_vite_template(dist);
}

const dist = process.argv[2];
if (dist === 'dist') {
	buildTemplates(dist);
}
