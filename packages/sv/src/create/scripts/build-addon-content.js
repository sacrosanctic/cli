import fs from 'node:fs';
import path from 'node:path';
import { copyAsset, listFiles, mkdirp } from '../utils.ts';

const addonsDir = path.resolve(import.meta.dirname, '../../addons');

/**
 * Bundle every addon content folder (any directory inside `src/addons/`,
 * e.g. `ai-tools/`) into an `addons/<folder>.json` manifest. Addons own these
 * files outright: they live next to the addon and are read back at runtime, so
 * `create` never sees them.
 *
 * Files under `<folder>/assets/` are treated exactly like template assets
 * (shared `copyAsset` helper in `src/create/utils.ts`): they are copied
 * verbatim to `<dist>/addons/<folder>/assets/` instead of being encoded as UTF-8
 * text into the JSON manifest, so binary files (images, fonts, etc.) survive
 * the build. At runtime, addons copy them out with the shared `copyAssets()`
 * helper from `src/create/utils.ts`, just like templates do.
 * @param {string} dist
 */
export function buildAddonContent(dist) {
	// A folder only counts as addon content when a `<folder>.ts` addon module
	// sits next to it. This keeps support dirs like `tests/` out of the build.
	const folders = fs
		.readdirSync(addonsDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				!entry.name.startsWith('.') &&
				fs.existsSync(path.join(addonsDir, `${entry.name}.ts`))
		)
		.map((entry) => entry.name)
		.sort();

	const addonsDist = path.join(dist, 'addons');
	mkdirp(addonsDist);

	for (const folder of folders) {
		const contentDir = path.join(addonsDir, folder);

		const names = listFiles(contentDir);

		const files = [];
		for (const name of names) {
			if (name === 'assets' || name.startsWith(`assets${path.sep}`)) {
				// Same as templates: verbatim copy, `DOT-` prefix so dotfiles
				// survive publishing. Runtime renames back via `copyAssets()`.
				copyAsset({
					from: path.join(contentDir, name),
					assetsDir: path.join(addonsDist, folder, 'assets'),
					name: path.relative('assets', name)
				});
				continue;
			}
			files.push({ name, contents: fs.readFileSync(path.join(contentDir, name), 'utf8') });
		}

		fs.writeFileSync(
			path.join(addonsDist, `${folder}.json`),
			JSON.stringify({ files }, null, '\t')
		);
	}
}
