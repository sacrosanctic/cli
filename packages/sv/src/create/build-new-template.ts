import fs from 'node:fs';
import path from 'node:path';
import parser from 'gitignore-parser';
import { transform } from 'sucrase';
import glob from 'tiny-glob/sync.js';
import type { File, LanguageType } from './index.ts';

const pkgRoot = path.resolve(import.meta.dirname, '.');

function convert_typescript(content: string): string {
	let { code } = transform(content, {
		transforms: ['typescript'],
		disableESTransforms: true
	});

	code = code.replace(/^\s*[a-z]+;$/gm, '');
	code = code.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"');

	return code;
}

/** @param {string} content */
function strip_jsdoc(content: string): string {
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
 * @param {string} string
 * @param {RegExp} regexp
 * @param {(m: any, attrs: string, typescript: string) => Promise<string>} replacer
 */
async function replace_async(
	string: string,
	regexp: RegExp,
	replacer: (m: any, attrs: string, typescript: string) => Promise<string>
): Promise<string> {
	const matches = Array.from(string.matchAll(regexp));
	const replacements = await Promise.all(
		matches.map((match) => replacer(match[0], match[1], match[2]))
	);
	let i = 0;
	return string.replace(regexp, () => replacements[i++]);
}

/** @param {string} dir */
function mkdirp(dir: string): void {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (e) {
		if ((e as any).code === 'EEXIST') return;
		throw e;
	}
}

/**
 * Generates template JSON files for the minimal template
 * @param {string} dist - output directory
 */
export async function generate_templates(dist: string): Promise<void> {
	const template = 'minimal';
	const dir = path.join(dist, 'templates', template);
	mkdirp(dir);

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

	const types: Record<LanguageType, File[]> = {
		typescript: [],
		checkjs: [],
		none: []
	};

	const files = glob('**/*', { cwd, filesOnly: true, dot: true });
	for (const name of files) {
		if (name === 'package.template.json') continue;
		if (!gitignore.accepts(name) || !ignore.accepts(name) || name === '.ignore') continue;

		if (/\.(ts|svelte)$/.test(name)) {
			const contents = fs.readFileSync(path.join(cwd, name), 'utf8');

			if (name.endsWith('.d.ts')) {
				if (name.endsWith('app.d.ts')) types.checkjs.push({ name, contents });
				types.typescript.push({ name, contents });
			} else if (name.endsWith('.ts')) {
				const js = convert_typescript(contents);

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
					(m, attrs, typescript) => {
						const imports = [];
						const import_pattern = /import (.+?) from/g;
						let import_match;
						while ((import_match = import_pattern.exec(typescript))) {
							const word_pattern = /[a-z_$][a-z0-9_$]*/gi;
							let word_match;
							while ((word_match = word_pattern.exec(import_match[1]))) {
								imports.push(word_match[0]);
							}
						}

						const suffix = `\n${imports.join(',')}`;
						const transformed = transform(typescript + suffix, {
							transforms: ['typescript'],
							disableESTransforms: true
						}).code.slice(0, -suffix.length);

						const contents = transformed.trim().replace(/^(.)/gm, '\t$1');

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
	fs.writeFileSync(path.join(dir, 'files.types=none.json'), JSON.stringify(types.none, null, '\t'));
}
