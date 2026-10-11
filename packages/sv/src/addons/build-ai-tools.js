// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const contentDir = path.resolve(import.meta.dirname, 'ai-tools');

/**
 * Bundle the ai-tools addon's content (MCP instructions, skills, sub-agents)
 * into `ai-tools.json`. The addon owns these files outright: they live next
 * to it and are read back at runtime, so `create` never sees them.
 * @param {string} dist
 */
export async function buildAiTools(dist) {
	/** @type {Array<{ name: string, contents: string }>} */
	const files = [];

	const globbed = fs
		.readdirSync(contentDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map(({ parentPath, name }) => path.join(path.relative(contentDir, parentPath), name))
		.sort();
	for (const name of globbed) {
		files.push({ name, contents: fs.readFileSync(path.join(contentDir, name), 'utf8') });
	}

	fs.mkdirSync(dist, { recursive: true });
	fs.writeFileSync(path.join(dist, 'ai-tools.json'), JSON.stringify({ files }, null, '\t'));
}
