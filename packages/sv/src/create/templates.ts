import fs from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import { pkg_root, invalid_json } from './utils.ts';

const publicTemplateTypes = ['minimal', 'demo', 'library', 'addon'] as const;
export const templateTypes = [...publicTemplateTypes, 'svelte'] as const;
export type TemplateType = (typeof templateTypes)[number];

export type LanguageType = 'typescript' | 'checkjs' | 'none';

export type TemplateMetadata = { name: TemplateType; title: string; description: string };
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
