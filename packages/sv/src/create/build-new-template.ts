import fs from 'node:fs';
import path from 'node:path';
import * as find from 'empathic/find';
import { transform } from 'sucrase';
import glob from 'tiny-glob/sync.js';
import { isNodeError } from '../core/common.ts';
import type { File, LanguageType } from './index.ts';

const SV_ROOT = path.dirname(find.up('package.json', { cwd: import.meta.dirname })!);

function strip_typescript(content: string): string {
	let { code } = transform(content, {
		transforms: ['typescript'],
		disableESTransforms: true
	});

	code = code.replace(/^\s*[a-z]+;$/gm, '');
	code = code.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"');

	return code;
}

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
 * Generates template JSON files for the minimal template
 */
export function generate_templates(templatePath: string, dist: string): void {
	const template = 'minimal';
	const outputPath = path.join(dist, template);

	const TEMPLATES_DIR = path.resolve(SV_ROOT, 'packages', 'sv', 'src', 'create', 'templates');

	try {
		fs.mkdirSync(outputPath, { recursive: true });
	} catch (e) {
		if (isNodeError(e) && e.code === 'EEXIST') return;
		throw e;
	}

	const cwd = path.resolve(TEMPLATES_DIR, template);

	const types: Record<LanguageType, File[]> = {
		typescript: [],
		checkjs: [],
		none: []
	};

	const files = glob('**/*', { cwd, filesOnly: true, dot: true });
	for (const name of files) {
		if (!name.endsWith('.ts') && !name.endsWith('.svelte')) continue;

		const contents = fs.readFileSync(path.join(cwd, name), 'utf8');
		if (name.endsWith('.d.ts')) {
			if (name.endsWith('app.d.ts')) types.checkjs.push({ name, contents });
			types.typescript.push({ name, contents });
		} else if (name.endsWith('.ts')) {
			const js = strip_typescript(contents);

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
			const js_contents = contents.replace(
				/<script([^>]+)>([\s\S]+?)<\/script>/g,
				(match, attrs, typescript) => {
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

	fs.writeFileSync(
		path.join(outputPath, 'files.types=typescript.json'),
		JSON.stringify(types.typescript, null, '\t')
	);
	fs.writeFileSync(
		path.join(outputPath, 'files.types=checkjs.json'),
		JSON.stringify(types.checkjs, null, '\t')
	);
	fs.writeFileSync(
		path.join(outputPath, 'files.types=none.json'),
		JSON.stringify(types.none, null, '\t')
	);
}
