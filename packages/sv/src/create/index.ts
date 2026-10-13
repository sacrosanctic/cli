import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName } from '@sveltejs/sv-utils';
import * as v from 'valibot';
import { filePaths, PackageJSONSchema } from '../core/common.ts';
import { mkdirp, fetchAssets, pkg_root, replace, kv } from './utils.ts';

export type TemplateType = 'minimal' | 'demo' | 'library' | 'addon' | 'svelte';
export type LanguageType = 'typescript' | 'checkjs' | 'none';

const publicTemplateTypes = ['minimal', 'demo', 'library', 'addon'] as const;

const FileSchema = v.object({ name: v.string(), contents: v.string() });
export type File = v.InferOutput<typeof FileSchema>;

export type Options = {
	cwd: string;
	name: string;
	template: TemplateType;
	types: LanguageType;
};
export function create({ cwd, ...options }: Options): void {
	mkdirp(cwd);

	write_template_files(options.template, options.types, options.name, cwd);
}

type TemplateMetadata = { name: TemplateType; title: string; description: string };
export const templates: TemplateMetadata[] = publicTemplateTypes.map((template_name) => {
	const meta_file_path = path.join(pkg_root, 'dist', 'templates', template_name, 'meta.json');
	const data = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.object({ title: v.string(), description: v.string() })),
		fs.readFileSync(meta_file_path, 'utf-8')
	);
	if (!data.success) throw invalid_json(meta_file_path, data.issues);
	const { title, description } = data.output;

	return {
		name: template_name,
		title,
		description
	};
});

function write_template_files(
	template: TemplateType,
	types: LanguageType,
	name: string,
	cwd: string
) {
	const template_dir = path.join(pkg_root, 'dist', 'templates', template);
	fetchAssets(`${template_dir}/assets`, cwd, name);

	const manifest = `${template_dir}/files.types=${types}.json`;
	const shared_path = `${template_dir}/files.shared.json`;

	const files_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(FileSchema)),
		fs.readFileSync(manifest, 'utf-8')
	);
	if (!files_result.success) throw invalid_json(manifest, files_result.issues);
	const shared_result = v.safeParse(
		v.pipe(v.string(), v.parseJson(), v.array(FileSchema)),
		fs.readFileSync(shared_path, 'utf-8')
	);
	if (!shared_result.success) throw invalid_json(shared_path, shared_result.issues);

	const files = [...shared_result.output, ...files_result.output];

	files.forEach((file) => {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, replace(file.contents, kv(name)));
	});

	const pkg_file = path.join(cwd, filePaths.packageJson);
	if (fs.existsSync(pkg_file)) {
		const pkg_result = v.safeParse(
			v.pipe(v.string(), v.parseJson(), PackageJSONSchema),
			fs.readFileSync(pkg_file, 'utf-8')
		);
		if (!pkg_result.success) throw invalid_json(pkg_file, pkg_result.issues);

		const pkg = pkg_result.output;

		pkg.dependencies = sort_keys(pkg.dependencies);
		pkg.devDependencies = sort_keys(pkg.devDependencies);
		pkg.name = sanitizeName(name, 'package');

		fs.writeFileSync(pkg_file, JSON.stringify(pkg, null, '\t') + '\n');
	}
}

function invalid_json(
	file_path: string,
	issues: [v.BaseIssue<unknown>, ...Array<v.BaseIssue<unknown>>]
): Error {
	const error = [
		`invalid JSON in ${file_path}:`,
		issues.map((issue) => (issue.path ? `${v.getDotPath(issue)}: ${issue.message}` : issue.message))
	].join('\n');

	return new Error(error);
}

function sort_keys<T>(obj?: Record<string, T>): Record<string, T> | undefined {
	if (!obj) return;

	return Object.keys(obj)
		.sort()
		.reduce<Record<string, T>>((sorted, key) => {
			sorted[key] = obj[key];
			return sorted;
		}, {});
}
