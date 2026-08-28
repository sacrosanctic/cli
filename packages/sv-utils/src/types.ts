import { transform } from 'sucrase';

export function strip_jsdoc(content: string): string {
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

export function convert_typescript(content: string): string {
	let { code } = transform(content, {
		transforms: ['typescript'],
		disableESTransforms: true
	});

	// sucrase leaves invalid class fields intact
	code = code.replace(/^\s*[a-z]+;$/gm, '');

	// Replace "local import" that ends with ".ts" to ".js"
	code = code.replace(/import (.+?) from ['"](.+?)\.ts['"]/g, 'import $1 from "$2.js"');

	return code;
}
