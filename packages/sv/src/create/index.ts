import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName } from '@sveltejs/sv-utils';
import { filePaths, type PackageJSON } from '../core/common.ts';
import { mkdirp, copyAssets, dist, replace, kv } from './utils.ts';

export type TemplateType = 'minimal' | 'demo' | 'library' | 'addon' | 'svelte';
export type LanguageType = 'typescript' | 'checkjs' | 'none';

const publicTemplateTypes = ['minimal', 'demo', 'library', 'addon'] as const;

export type Options = {
	cwd: string;
	name: string;
	template: TemplateType;
	types: LanguageType;
};

export type File = {
	name: string;
	contents: string;
};

export function create({ cwd, ...options }: Options): void {
	mkdirp(cwd);

	write_template_files(options.template, options.types, options.name, cwd);
}

export type TemplateMetadata = { name: TemplateType; title: string; description: string };
export const templates: TemplateMetadata[] = publicTemplateTypes.map((dir) => {
	const meta_file = dist(`templates/${dir}/meta.json`);
	const { title, description } = JSON.parse(fs.readFileSync(meta_file, 'utf8'));

	return {
		name: dir,
		title,
		description
	};
});

function write_template_files(template: string, types: LanguageType, name: string, cwd: string) {
	const dir = dist(`templates/${template}`);
	copyAssets(`${dir}/assets`, cwd, name);

	// `package.json` ships as a regular entry of the files manifest, so there
	// is nothing else to copy here. (The internal-only `svelte` template has
	// no `package.json` entry, hence the `existsSync` guard below.)
	const manifest = `${dir}/files.types=${types}.json`;
	const files = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as File[];

	files.forEach((file) => {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, replace(file.contents, kv(name)));
	});

	const pkg_file = path.join(cwd, filePaths.packageJson);
	if (fs.existsSync(pkg_file)) {
		const pkg: PackageJSON = JSON.parse(fs.readFileSync(pkg_file, 'utf-8'));

		pkg.dependencies = sort_keys(pkg.dependencies);
		pkg.devDependencies = sort_keys(pkg.devDependencies);
		pkg.name = sanitizeName(name, 'package');

		fs.writeFileSync(pkg_file, JSON.stringify(pkg, null, '\t') + '\n');
	}
}

function sort_keys<T>(obj?: Record<string, T>) {
	if (!obj) return;

	return Object.keys(obj)
		.sort()
		.reduce<Record<string, T>>((sorted, key) => {
			sorted[key] = obj[key];
			return sorted;
		}, {});
}
