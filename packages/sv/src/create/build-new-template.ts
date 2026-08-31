import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'sucrase';
import glob from 'tiny-glob/sync.js';
import { isNodeError } from '../core/common.ts';
import type { File, LanguageType } from './index.ts';

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

export function generate_template(templatePath: string, outputPath: string): void {
	try {
		fs.mkdirSync(outputPath, { recursive: true });
	} catch (e) {
		if (isNodeError(e) && e.code === 'EEXIST') return;
		throw e;
	}

	const types: Record<LanguageType, File[]> = {
		typescript: [],
		checkjs: [],
		none: []
	};

	const files = glob('**/*', { cwd: templatePath, filesOnly: true, dot: true });
	for (const name of files) {
		if (name.endsWith('.d.ts')) {
			const contents = fs.readFileSync(path.join(templatePath, name), 'utf8');
			if (name.endsWith('app.d.ts')) {
				types.checkjs.push({ name, contents });
			}
			types.typescript.push({ name, contents });
			continue;
		}

		if (name.endsWith('.ts')) {
			const contents = fs.readFileSync(path.join(templatePath, name), 'utf8');
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
			continue;
		}

		if (name.endsWith('.svelte')) {
			const contents = fs.readFileSync(path.join(templatePath, name), 'utf8');
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

	for (const [key, content] of Object.entries(types)) {
		fs.writeFileSync(path.join(outputPath, `${key}.json`), JSON.stringify(content, null, '\t'));
	}
}
