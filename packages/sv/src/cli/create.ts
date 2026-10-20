import path from 'node:path';
import process from 'node:process';
import * as p from '@clack/prompts';
import { color, resolveCommandArray } from '@sveltejs/sv-utils';
import { Command, Option } from 'commander';
import * as v from 'valibot';
import { validatePlaygroundUrl } from '../addons/playground.ts';
import * as common from '../core/common.ts';
import { detectPackageManager, installOption } from '../core/package-manager.ts';
import { templates } from '../create/index.ts';
import { createProject, OptionsSchema, ProjectPathSchema, langs } from '../create/project.ts';
import { formatAddonHelpSection } from './add.ts';

const langOption = new Option('--types <lang>', 'add type checking').choices(langs);
const templateOption = new Option('--template <type>', 'template to scaffold').choices(
	templates.map((t) => t.name)
);
const noAddonsOption = new Option('--no-add-ons', 'do not prompt to add add-ons').conflicts('add');
const addOption = new Option(
	'--add <addon...>',
	'add-ons to include (see Add-Ons section below)'
).default([]);
const addonNameOption = new Option(
	'--addon-name <name>',
	'name for the addon package (e.g. @<org>/<pkg> or <pkg>)'
);

export const create = new Command('create')
	.description('Scaffold a new project (--add to include add-ons)')
	.argument('[path]', 'where the project will be created')
	.addOption(templateOption)
	.addOption(langOption)
	.option('--no-types')
	.addOption(noAddonsOption)
	.addOption(addOption)
	.addOption(addonNameOption)
	.addOption(common.cliOptions.noInstall)
	.option('--from-playground <url>', 'create a project from the svelte playground')
	.option('--no-dir-check', 'even if the folder is not empty, no prompt will be shown')
	.addOption(common.cliOptions.noDownloadCheck)
	.addOption(installOption)
	.configureHelp({
		...common.helpConfig,
		formatHelp(cmd, helper) {
			const s = common.getHelpSections(cmd, helper);

			const addonSection = formatAddonHelpSection({
				styleTitle: s.styleTitle,
				formatItem: (term, desc) =>
					s.formatItem(helper.styleArgumentTerm(term), helper.styleArgumentDescription(desc))
			});

			return [
				...s.usage,
				...s.description,
				...s.arguments,
				...s.options,
				...addonSection,
				s.styleTitle('Non-interactive usage:'),
				'  Provide --template, --types, --add, and --install (or --no-install) to skip prompts entirely.',
				'  Note: --add and --no-add-ons cannot be used together.',
				'',
				s.styleTitle('Examples:'),
				'  sv create my-app --template minimal --types ts --add prettier eslint --install pnpm',
				'  sv create my-app --template minimal --types ts --add prettier vitest="usages:unit" tailwindcss="plugins:none" --install pnpm',
				'  sv create my-app --template minimal --types ts --add drizzle="database:postgresql+client:postgres.js" --no-install',
				''
			].join('\n');
		}
	})
	.action((projectPath, opts) => {
		const cwd = v.parse(ProjectPathSchema, projectPath);
		const options = v.parse(OptionsSchema, opts);

		if (options.fromPlayground && !validatePlaygroundUrl(options.fromPlayground)) {
			console.error(color.error(`Error: Invalid playground URL: ${options.fromPlayground}`));
			process.exit(1);
		}

		common.runCommand(async () => {
			const { directory, addOnNextSteps, packageManager, depsInstalled } = await createProject(
				cwd,
				options
			);

			let i = 1;
			const steps: string[] = ['📁 Project steps', ''];
			const relative = path.relative(process.cwd(), directory);
			const pm = packageManager ?? (await detectPackageManager(directory));
			if (relative !== '') {
				const pathHasSpaces = relative.includes(' ');
				steps.push(
					`  ${i++}: ${color.command(`cd ${pathHasSpaces ? `"${relative}"` : relative}`)}`
				);
			}
			if (packageManager && !depsInstalled) {
				steps.push(`  ${i++}: Install ${color.command(pm)}`);
			}
			if (!packageManager || !depsInstalled) {
				steps.push(`  ${i++}: ${color.command(resolveCommandArray(pm, 'install', []))}`);
			}
			steps.push(`  ${i++}: ${color.command(resolveCommandArray(pm, 'run', ['dev', '--open']))}\n`);
			steps.push(`To close the dev server, hit ${color.command('Ctrl-C')}`);

			if (addOnNextSteps.length > 0) {
				steps.push('', '🧩 Add-on steps', '');
				for (const step of addOnNextSteps) {
					const indented = step.replaceAll('  -', '    -');
					steps.push(`  ${indented}`);
				}
			}

			steps.push('', `Stuck? Visit us at ${color.website('https://svelte.dev/chat')}`);

			p.note(steps.join('\n'), "What's next?", { format: (line) => line });
		});
	})
	.showHelpAfterError(true);
