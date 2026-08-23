import fs from 'node:fs';
import path from 'node:path';
import { loadPackageJson, sanitizeName } from '@sveltejs/sv-utils';
import type { LanguageType, TemplateType } from '../create/index.ts';
import { dist } from '../create/utils.ts';
import { filePaths } from './common.ts';
import { createWorkspace, type Workspace } from './workspace.ts';

type BootstrapOptions = {
	cwd: string;
	template: TemplateType;
	type: LanguageType;
	/** used to name the skeleton package.json that is written before the scaffold addon runs */
	name?: string;
};

/**
 * Scaffolds an empty project skeleton (a minimal package.json) and derives a
 * workspace from the template metadata. This gives every add-on - including the
 * scaffold add-on, which materializes the actual template files - a valid
 * workspace to run against.
 */
export async function createBootstrapWorkspace({
	cwd,
	template,
	type,
	name
}: BootstrapOptions): Promise<Workspace> {
	fs.mkdirSync(cwd, { recursive: true });

	const pkgPath = path.join(cwd, filePaths.packageJson);
	if (!fs.existsSync(pkgPath)) {
		const skeleton = {
			name: sanitizeName(name ?? 'project', 'package'),
			private: true
		};
		fs.writeFileSync(pkgPath, JSON.stringify(skeleton, null, '\t') + '\n');
	}

	const override: {
		isKit?: boolean;
		directory?: Workspace['directory'];
		dependencies: Record<string, string>;
	} = { dependencies: {} };

	// These are our default project structure so we know that it's a kit project
	if (template === 'minimal' || template === 'demo' || template === 'library') {
		override.isKit = true;
		override.directory = {
			src: 'src',
			lib: 'src/lib',
			kitRoutes: 'src/routes'
		};
	}

	// Let's read the package.json of the template we will use and add the dependencies to the override
	const templatePackageJsonPath = dist(`templates/${template}`);
	const { data: packageJson } = loadPackageJson(templatePackageJsonPath);
	override.dependencies = {
		...packageJson.devDependencies,
		...packageJson.dependencies,
		...override.dependencies
	};

	const tentativeWorkspace = await createWorkspace({ cwd, override });

	const virtualWorkspace: Workspace = {
		...tentativeWorkspace,
		language: type === 'typescript' ? 'ts' : 'js',
		file: {
			...tentativeWorkspace.file,
			viteConfig:
				type === 'typescript' ? filePaths.viteConfigTS : filePaths.viteConfig
		}
	};

	return virtualWorkspace;
}
