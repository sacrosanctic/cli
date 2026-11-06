import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import * as find from 'empathic/find';
import { format } from 'oxfmt';
import oxfmtConfig from '../../../../../oxfmt.config.ts';
import { saveAsset, listFiles, mkdirp } from '../utils.ts';

/** @import { LanguageType } from '../index.ts' */
/** @import { TemplateFile } from '../../core/common.ts' */

const pnpmWorkspace = find.up('pnpm-workspace.yaml', { cwd: import.meta.dirname });
if (!pnpmWorkspace) {
	throw new Error("This project must have a 'pnpm-workspace.yaml' file");
}
const ROOT = path.dirname(pnpmWorkspace);
const pkgRoot = path.resolve(import.meta.dirname, '..');

/**
 * @param {string} content
 * @returns {string}
 */
function strip_typescript(content) {
	return (
		stripTypeScriptTypes(content)
			// Replace "local import" that ends with ".ts" to ".js"
			.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"')
	);
}

/**
 * @param {string} content
 * @returns {string}
 */
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
 * @param {string} dist
 */
export async function generate_kit_template(dist) {
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

		/** @type {Record<LanguageType, TemplateFile[]>} */
		const types = {
			typescript: [],
			checkjs: [],
			none: []
		};

		/** @type {TemplateFile[]} */
		const shared = [];

		const files = listFiles(cwd);
		for (const name of files) {
			// Every file in the template folder is user-facing, except
			// build-time inputs: `.meta.json` (picker text, handled above),
			// `package.json` (split per language below) and `tsconfig.json`
			// (renamed to `jsconfig.json` for JS outputs).
			// The `.gitignore` doubles as the user-facing gitignore,
			// `.npmrc` is a real user-facing file.
			if (name === '.meta.json') continue;

			if (name === 'package.json') {
				const getVersion = (/** @type {string} */ pkgDir) => {
					const pkgPath = path.join(ROOT, 'packages', pkgDir, 'package.json');
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

			if (/\.(ts|svelte)$/.test(name)) {
				const contents = fs.readFileSync(path.join(cwd, name), 'utf8');

				if (name.endsWith('.d.ts')) {
					if (name.endsWith('app.d.ts')) types.checkjs.push({ name, contents });
					types.typescript.push({ name, contents });
				} else if (name.endsWith('.ts')) {
					const js = await strip_typescript(contents);

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
					const js_contents = await replace_async(
						contents,
						/<script([^>]+)>([\s\S]+?)<\/script>/g,
						async (
							/** @type {any} */ m,
							/** @type {string} */ attrs,
							/** @type {string} */ typescript
						) => {
							const transformed = stripTypeScriptTypes(typescript);

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
				// text files are embedded verbatim in `files.shared.json` (copied out
				// as UTF-8 at runtime); only binaries go to the assets folder.
				// `.gitignore` and `.npmrc` must be embedded too, as npm strips
				// dotfiles like these when publishing.
			} else if (
				name === '.gitignore' ||
				name === '.npmrc' ||
				/\.(js|cjs|mjs|json|md|html|css|txt)$/.test(name)
			) {
				shared.push({ name, contents: fs.readFileSync(path.join(cwd, name), 'utf8') });
			} else {
				saveAsset({ from: path.join(cwd, name), assetsDir: assets, name });
			}
		}

		// identical files across every language variant belong in
		// `files.shared.json` instead of being duplicated per variant.
		const langs = /** @type {LanguageType[]} */ (Object.keys(types)).filter(
			(lang) => types[lang].length > 0
		);
		const byName = new Map();
		for (const lang of langs) {
			for (const file of types[/** @type {LanguageType} */ (lang)]) {
				if (!byName.has(file.name)) byName.set(file.name, new Map());
				byName.get(file.name).set(lang, file.contents);
			}
		}
		for (const [name, contentsByLang] of byName) {
			const contentsList = [...contentsByLang.values()];
			const contents = contentsList[0];
			if (
				contentsList.length !== langs.length ||
				contentsList.some((entry) => entry !== contents)
			) {
				continue;
			}
			shared.push({ name, contents });
			for (const lang of langs) {
				types[/** @type {LanguageType} */ (lang)] = types[
					/** @type {LanguageType} */ (lang)
				].filter((file) => file.name !== name);
			}
		}

		if (shared.length > 0) {
			fs.writeFileSync(path.join(dir, 'files.shared.json'), JSON.stringify(shared, null, '\t'));
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
