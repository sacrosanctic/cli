// @ts-check
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import parser from 'gitignore-parser';
import { format } from 'oxfmt';
import { transform } from 'sucrase';
import oxfmtConfig from '../../../../../oxfmt.config.ts';

/** @import { File, LanguageType } from '../index.ts' */

const pkgRoot = path.resolve(import.meta.dirname, '..');
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
 * Derive the per-language `package.json` variants from the template's
 * TypeScript-complete `package.json`. `checkjs` only rewrites the tsconfig
 * path in the check scripts; `none` drops typechecking entirely.
 * @param {Record<string, any>} pkg
 * @param {string} template
 */
function package_variants(pkg, template) {
	const typescript = pkg;

	const checkjs = JSON.parse(JSON.stringify(pkg));
	for (const key of ['check', 'check:watch']) {
		if (typeof checkjs.scripts?.[key] === 'string') {
			checkjs.scripts[key] = checkjs.scripts[key].replaceAll('./tsconfig.json', './jsconfig.json');
		}
	}

	const none = JSON.parse(JSON.stringify(pkg));
	if (none.scripts) {
		delete none.scripts.check;
		delete none.scripts['check:watch'];
	}
	if (none.devDependencies) {
		delete none.devDependencies['svelte-check'];
		// `typescript` is only a typechecking dependency, except for the
		// library template where packaging (`svelte-package`) needs it
		if (template !== 'library') delete none.devDependencies.typescript;
	}

	return { typescript, checkjs, none };
}

/** @param {string} dist */
async function generate_templates(dist) {
	const templates = fs.readdirSync(path.resolve(pkgRoot, 'templates'));

	for (const template of templates) {
		if (template[0] === '.') continue;

		const dir = path.join(dist, 'templates', template);
		const assets = path.join(dir, 'assets');
		mkdirp(assets);

		const cwd = path.resolve(pkgRoot, 'templates', template);

		const meta_file = path.join(cwd, '.meta.json');
		if (!fs.existsSync(meta_file)) {
			throw new Error(`"${template}" template must have a .meta.json file`);
		}
		const meta = JSON.parse(fs.readFileSync(meta_file, 'utf-8'));

		const gitignore_file = path.join(cwd, '.gitignore');
		if (!fs.existsSync(gitignore_file)) {
			throw new Error(`"${template}" template must have a .gitignore file`);
		}

		const gitignore = parser.compile(fs.readFileSync(gitignore_file, 'utf-8'));

		/** @type {Record<LanguageType, File[]>} */
		const types = {
			typescript: [],
			checkjs: [],
			none: []
		};

		const files = fs
			.readdirSync(cwd, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map(({ parentPath, name }) => path.join(path.relative(cwd, parentPath), name))
			.sort();
		for (const name of files) {
			// Every file in the template folder is user-facing, except
			// build-time inputs: `.meta.json` (picker text, handled above),
			// `package.json` (split per language below) and `tsconfig.json`
			// (renamed to `jsconfig.json` for JS outputs).
			// The `.gitignore` doubles as the user-facing gitignore.
			if (name === '.meta.json') continue;

			if (name === 'package.json') {
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

				const variants = package_variants(JSON.parse(contents), template);
				// `package.json` is just another typed file: it rides along
				// in `files.types=*` like everything else, no separate manifest.
				for (const lang of /** @type {LanguageType[]} */ (['typescript', 'checkjs', 'none'])) {
					types[lang].push({
						name: 'package.json',
						contents: JSON.stringify(variants[lang], null, '\t') + '\n'
					});
				}
				continue;
			}

			if (name === 'tsconfig.json') {
				const contents = fs.readFileSync(path.join(cwd, name), 'utf8');
				types.typescript.push({ name, contents });
				types.checkjs.push({ name: 'jsconfig.json', contents });
				types.none.push({ name: 'jsconfig.json', contents });
				continue;
			}

			// ignore contents of .gitignore
			if (!gitignore.accepts(name)) continue;

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

		fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, '\t'));
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

/**
 * Build `shared.json` from `src/create/assets/`. Each top-level folder is a
 * condition (`agents`, `mcp`, `skills`, `playground`); subpaths are preserved.
 * Unlike the old `shared/` folder there is no `+`/`-` prefix parsing and no
 * template/language splitting — those now live in the templates themselves.
 * @param {string} dist
 */
async function generate_resources(dist) {
	const cwd = path.resolve(pkgRoot, 'assets');

	/** @type {Array<{ name: string, include: string[], exclude: string[], contents: string }>} */
	const files = [];

	const globbed = fs
		.readdirSync(cwd, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map(({ parentPath, name }) => path.join(path.relative(cwd, parentPath), name))
		.sort();
	for (const file of globbed) {
		const contents = fs.readFileSync(path.join(cwd, file), 'utf8');
		const [condition, ...rest] = file.split(path.sep);

		if (rest.length === 0) {
			throw new Error(`Asset "${file}" must live inside a condition folder`);
		}

		files.push({ name: rest.join('/'), include: [condition], exclude: [], contents });
	}

	fs.writeFileSync(path.join(dist, 'shared.json'), JSON.stringify({ files }, null, '\t'));
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
		const files = fs
			.readdirSync(srcDir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map(({ parentPath, name }) => path.join(path.relative(srcDir, parentPath), name))
			.sort();

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

	await generate_resources(dist);
	await generate_templates(dist);
	generate_vite_template(dist);
}

const dist = process.argv[2];
if (dist === 'dist') {
	buildTemplates(dist);
}
