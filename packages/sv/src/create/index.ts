import fs from 'node:fs';
import path from 'node:path';
import { sanitizeName } from '@sveltejs/sv-utils';
import { filePaths } from '../core/common.ts';
import {
	getTypeCheckingFiles,
	getTypeCheckingPackageJsonEdits,
	type PackageJsonEdits
} from './configs.ts';
import { mkdirp, copy, dist, replace, kv } from './utils.ts';

export type TemplateType = (typeof templateTypes)[number];
export type LanguageType = (typeof languageTypes)[number];

const publicTemplateTypes = ['minimal', 'demo', 'library', 'addon'] as const;
const templateTypes = ['minimal', 'demo', 'library', 'addon', 'svelte'] as const;
const languageTypes = ['typescript', 'checkjs', 'none'] as const;

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

	// No need to write type checking files for 'svelte' template
	if (options.template !== 'svelte') {
		write_type_checking_files(cwd, options);
	}

	// Files that are not relevant for 'addon' template
	if (options.template === 'addon') {
		for (const name of [
			'svelte.config.js',
			'svelte.config.ts',
			'vite.config.js',
			'vite.config.ts'
		]) {
			fs.rmSync(path.join(cwd, name), { force: true });
		}
	}
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
	copy(`${dir}/assets`, cwd, (name: string) => name.replace('DOT-', '.'), kv(name));
	copy(`${dir}/package.json`, `${cwd}/package.json`, undefined, kv(name));

	const manifest = `${dir}/files.types=${types}.json`;
	const files = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as File[];

	files.forEach((file) => {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, replace(file.contents, kv(name)));
	});
}

function write_type_checking_files(
	cwd: string,
	options: Omit<Options, 'cwd'> | { template: TemplateType; types: LanguageType; name?: string }
): void {
	const pkg_file = path.join(cwd, filePaths.packageJson);
	const pkg = /** @type {any} */ JSON.parse(fs.readFileSync(pkg_file, 'utf-8'));

	for (const file of getTypeCheckingFiles(options.template, options.types)) {
		const dest = path.join(cwd, file.name);
		mkdirp(path.dirname(dest));
		fs.writeFileSync(dest, file.contents);
	}

	apply_package_json_edits(pkg, getTypeCheckingPackageJsonEdits(options.types));

	pkg.dependencies = sort_keys(pkg.dependencies);
	pkg.devDependencies = sort_keys(pkg.devDependencies);

	if (options.name) pkg.name = sanitizeName(options.name, 'package');

	fs.writeFileSync(pkg_file, JSON.stringify(pkg, null, '\t') + '\n');
}

function apply_package_json_edits(pkg: any, edits: PackageJsonEdits | undefined): void {
	if (!edits) return;

	if (edits.scripts) {
		pkg.scripts = { ...pkg.scripts, ...edits.scripts };
	}
	if (edits.devDependencies) {
		pkg.devDependencies = { ...pkg.devDependencies, ...edits.devDependencies };
	}
}

function sort_keys(obj: Record<string, any>) {
	if (!obj) return;

	const sorted: Record<string, any> = {};
	Object.keys(obj)
		.sort()
		.forEach((key) => {
			sorted[key] = obj[key];
		});

	return sorted;
}
