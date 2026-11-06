import fs from 'node:fs';
import path from 'node:path';
import { saveAsset, listFiles, mkdirp, isBinaryFile } from '../utils.ts';

const addon_path = path.resolve(import.meta.dirname, '../../addons');

/**
 * Bundle every folder in `src/addons/<addon_name>/` that shares a `src/addons/<addon_name>.ts`
 * into an `addons/<folder>.json` manifest.
 * @param {string} dist_dir
 */
export function generate_addon_manifest(dist_dir) {
	const manifest_path = path.join(dist_dir, 'addons');
	mkdirp(manifest_path);

	const addons = fs
		.readdirSync(addon_path, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && fs.existsSync(path.join(addon_path, `${entry.name}.ts`))
		)
		.map((entry) => entry.name)
		.sort();

	for (const addon_name of addons) {
		const source_path = path.join(addon_path, addon_name);
		const names = listFiles(source_path);

		const files = [];
		for (const name of names) {
			const file_path = path.join(source_path, name);

			if (isBinaryFile(file_path)) {
				saveAsset({
					from: file_path,
					assetsDir: path.join(manifest_path, addon_name, 'assets'),
					name
				});
				continue;
			}

			files.push({ name, contents: fs.readFileSync(file_path, 'utf8') });
		}

		fs.writeFileSync(
			path.join(manifest_path, `${addon_name}.json`),
			JSON.stringify({ files }, null, '\t')
		);
	}
}
