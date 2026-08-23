import { defineAddon, defineAddonOptions } from '../core/config.ts';
import { create, type LanguageType, type TemplateType, templates } from './index.ts';

/**
 * Internal add-on that materializes the chosen template into the project.
 * It is not part of `officialAddons` - `sv create` always runs it first,
 * before any user-selected add-on.
 */
export const scaffoldAddon = defineAddon({
	id: 'scaffold',
	shortDescription: 'Svelte project scaffolding',
	options: defineAddonOptions()
		.add('template', {
			question: 'Which template would you like?',
			type: 'select',
			default: 'minimal' as TemplateType,
			options: templates.map((t) => ({
				value: t.name,
				label: t.title,
				hint: t.description
			})),
			required: true
		})
		.add('types', {
			question: 'Add type checking with TypeScript?',
			type: 'select',
			default: 'typescript' as LanguageType,
			options: [
				{ value: 'typescript', label: 'Yes, using TypeScript syntax' },
				{ value: 'checkjs', label: 'Yes, using JavaScript with JSDoc comments' },
				{ value: 'none', label: 'No' }
			],
			required: true
		})
		.add('name', {
			question: 'What is the name of your project?',
			type: 'string',
			default: '',
			required: false
		})
		.build(),
	run: ({ cwd, options }) => {
		create({
			cwd,
			name: options.name,
			template: options.template,
			types: options.types
		});
	}
});
