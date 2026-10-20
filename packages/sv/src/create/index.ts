import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName } from '@sveltejs/sv-utils';
import * as v from 'valibot';
import { filePaths, TemplateFile, type PackageJSON } from '../core/common.ts';
import { type LanguageType, type TemplateType } from './templates.ts';
import { mkdirp, dist_dir, invalid_json, copy, replace } from './utils.ts';

export { templates, type TemplateMetadata } from './templates.ts';
export type { TemplateType, LanguageType } from './templates.ts';

export type Options = { cwd: string; name: string; template: TemplateType; types: LanguageType };

/**
 * create a project based on a template
 */
export function create({ cwd, name: project_name, template, types }: Options): void {
	mkdirp(cwd);

	const template_dir = path.join(dist_dir, 'templates', template);
	copy(path.join(template_dir, 'assets'), cwd, (file: string) => file.replace('DOT-', '.'));

	const typed_file_path = path.join(template_dir, `files.types=${types}.json`);
	const shared_file_path = path.join(template_dir, 'files.shared.json');

	const typed_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(TemplateFile)),
		fs.readFileSync(typed_file_path, 'utf-8')
	);
	if (!typed_result.success) throw invalid_json(typed_file_path, typed_result.issues);

	const shared_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(TemplateFile)),
		fs.readFileSync(shared_file_path, 'utf-8')
	);
	if (!shared_result.success) throw invalid_json(shared_file_path, shared_result.issues);

	const files = [...shared_result.output, ...typed_result.output];

	files.forEach((file) => {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, replace(file.contents, kv(project_name)));
	});

	const package_json_path = path.join(cwd, filePaths.packageJson);
	if (fs.existsSync(package_json_path)) {
		const pkg: PackageJSON = JSON.parse(fs.readFileSync(package_json_path, 'utf-8'));
		pkg.name = sanitizeName(project_name, 'package');
		fs.writeFileSync(package_json_path, JSON.stringify(pkg, null, '\t') + '\n');
	}
}

function kv(name: string): Record<string, string> {
	const protocolName = name.startsWith('@') ? name.split('/')[0] : name;
	return {
		'$SV-PROTOCOL-NAME-TODO$': protocolName,
		'$SV-NAME-TODO$': name
	};
}
