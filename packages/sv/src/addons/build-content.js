// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const addonsDir = import.meta.dirname;

/**
 * Bundle every addon content folder (any directory inside `src/addons/`,
 * e.g. `ai-tools/`) into a `<folder>.json` manifest. Addons own these files
 * outright: they live next to the addon and are read back at runtime, so
 * `create` never sees them.
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

	for (const folder of folders) {
		const contentDir = path.join(addonsDir, folder);

		const files = fs
			.readdirSync(contentDir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map(({ parentPath, name }) => path.join(path.relative(contentDir, parentPath), name))
			.sort()
			.map((name) => ({ name, contents: fs.readFileSync(path.join(contentDir, name), 'utf8') }));

		fs.mkdirSync(dist, { recursive: true });
		fs.writeFileSync(path.join(dist, `${folder}.json`), JSON.stringify({ files }, null, '\t'));
	}
}
