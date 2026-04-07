/**
 * Parses a selector like `## Add-on Info > drizzle` into parent header and child.
 * The child header level is one deeper than the parent (e.g. `##` parent -> `###` child).
 */
function parseSelector(selector: string): { section: string; child?: string } {
	const parts = selector.split(' > ');
	if (parts.length === 1) return { section: parts[0] };

	const section = parts[0];
	const level = section.match(/^#+/)?.[0].length ?? 2;
	return { section, child: '#'.repeat(level + 1) + ' ' + parts[1] };
}

/**
 * Finds a section's boundaries in content.
 * Returns start/end indices or undefined if not found.
 */
function findSection(content: string, header: string): { start: number; end: number } | undefined {
	const idx = content.indexOf(header);
	if (idx === -1) return undefined;

	const afterHeader = idx + header.length;
	const level = header.match(/^#+/)?.[0] ?? '##';
	const nextSameLevel = content.indexOf(`\n${level} `, afterHeader);

	return { start: idx, end: nextSameLevel !== -1 ? nextSameLevel : content.length };
}

/**
 * Upserts content at a markdown selector.
 *
 * Selector format:
 * - `## Section > child` - upsert `### child` within `## Section`
 *
 * Returns a `(content: string) => string` transform for use with `sv.file()`.
 * If the parent section doesn't exist, returns content unchanged.
 */
export function upsert(selector: string, lines: string[]): (content: string) => string {
	return (content) => {
		if (lines.length === 0) return content;

		const { section, child } = parseSelector(selector);
		if (!child) return content;

		const parent = findSection(content, section);
		if (!parent) return content;

		const body = content.slice(parent.start + section.length, parent.end);
		const childBlock = `${child}\n\n${lines.map((l) => `- ${l}`).join('\n')}`;

		const childIdx = body.indexOf(`\n${child}\n`);

		let newBody: string;
		if (childIdx !== -1) {
			const afterChild = childIdx + child.length + 2;
			const level = child.match(/^#+/)?.[0] ?? '###';
			const nextChild = body.indexOf(`\n${level} `, afterChild);
			const childEnd = nextChild !== -1 ? nextChild : body.length;
			newBody = body.slice(0, childIdx) + '\n' + childBlock + body.slice(childEnd);
		} else {
			newBody = body.trimEnd() + '\n\n' + childBlock + '\n';
		}

		return content.slice(0, parent.start + section.length) + newBody + content.slice(parent.end);
	};
}

/**
 * Removes a section if it has no meaningful content (no sub-headers, only whitespace).
 *
 * Selector format:
 * - `## Section` - remove `## Section` if empty
 *
 * Returns a `(content: string) => string` transform for use with `sv.file()`.
 */
export function removeIfEmpty(selector: string): (content: string) => string {
	return (content) => {
		const { section } = parseSelector(selector);
		const found = findSection(content, section);
		if (!found) return content;

		const body = content.slice(found.start + section.length, found.end);
		const level = section.match(/^#+/)?.[0] ?? '##';
		if (body.includes(`${level}# `)) return content;
		if (body.trim().length > 0) return content;

		const removeStart =
			found.start > 0 && content[found.start - 1] === '\n' ? found.start - 1 : found.start;
		return content.slice(0, removeStart) + content.slice(found.end);
	};
}
