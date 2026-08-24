import fs from 'node:fs';
import path from 'node:path';
import { dist } from '../create/utils.ts';

export type TemplateFile = {
	/** path relative to the add-on's template root, forward slashes */
	path: string;
	contents: string;
};

/**
 * Returns every file shipped in an add-on's conventional `template/` directory
 * (see buildCliTemplates in the root tsdown config, which copies them to
 * `<dist>/addon-templates/<add-on id>/`). Paths are relative to the template
 * root and use forward slashes. Returns an empty array when the add-on has no
 * template directory.
 */
export function getTemplateFiles(addonId: string): TemplateFile[] {
	const root = dist(`addon-templates/${addonId}`);
	if (!fs.existsSync(root)) return [];
	return walk(root, root).sort((a, b) => a.path.localeCompare(b.path));
}

function walk(dir: string, base: string, out: TemplateFile[] = []): TemplateFile[] {
	for (const entry of fs.readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (fs.statSync(full).isDirectory()) {
			walk(full, base, out);
		} else {
			out.push({
				path: path.relative(base, full).replaceAll('\\', '/'),
				contents: fs.readFileSync(full, 'utf8')
			});
		}
	}
	return out;
}
