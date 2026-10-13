import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName } from '@sveltejs/sv-utils';
import * as v from 'valibot';
import { filePaths, type PackageJSON } from '../core/common.ts';
import { mkdirp, fetchAssets, pkg_root, replace, kv, invalid_json } from './utils.ts';

const publicTemplateTypes = ['minimal', 'demo', 'library', 'addon'] as const;
export const templateTypes = [...publicTemplateTypes, 'svelte'] as const;
export type TemplateType = (typeof templateTypes)[number];

export type LanguageType = 'typescript' | 'checkjs' | 'none';

const FileSchema = v.object({ name: v.string(), contents: v.string() });
export type File = v.InferOutput<typeof FileSchema>;

export type Options = { cwd: string; name: string; template: TemplateType; types: LanguageType };
export function create({ cwd, name, template, types }: Options): void {
	mkdirp(cwd);

	const template_path = path.join(pkg_root, 'dist', 'templates', template);
	fetchAssets(`${template_path}/assets`, cwd, name);

	const typed_file_path = `${template_path}/files.types=${types}.json`;
	const shared_file_path = `${template_path}/files.shared.json`;

	const typed_file_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(FileSchema)),
		fs.readFileSync(typed_file_path, 'utf-8')
	);
	if (!typed_file_result.success) throw invalid_json(typed_file_path, typed_file_result.issues);

	const shared_file_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(FileSchema)),
		fs.readFileSync(shared_file_path, 'utf-8')
	);
	if (!shared_file_result.success) throw invalid_json(shared_file_path, shared_file_result.issues);

	const files = [...shared_file_result.output, ...typed_file_result.output];

	files.forEach((file) => {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, replace(file.contents, kv(name)));
	});

	const package_json_path = path.join(cwd, filePaths.packageJson);
	if (fs.existsSync(package_json_path)) {
		const pkg: PackageJSON = JSON.parse(fs.readFileSync(package_json_path, 'utf-8'));
		pkg.name = sanitizeName(name, 'package');
		fs.writeFileSync(package_json_path, JSON.stringify(pkg, null, '\t') + '\n');
	}
}

type TemplateMetadata = { name: TemplateType; title: string; description: string };
export const templates: TemplateMetadata[] = publicTemplateTypes.map((template_name) => {
	const meta_file_path = path.join(pkg_root, 'dist', 'templates', template_name, 'meta.json');
	const result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.object({ title: v.string(), description: v.string() })),
		fs.readFileSync(meta_file_path, 'utf-8')
	);
	if (!result.success) throw invalid_json(meta_file_path, result.issues);
	const { title, description } = result.output;

	return {
		name: template_name,
		title,
		description
	};
});
