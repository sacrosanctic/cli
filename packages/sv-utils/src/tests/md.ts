import { describe, expect, it } from 'vitest';
import { upsert, removeIfEmpty } from '../tooling/md.ts';

const README = `# sv

Everything you need to build a Svelte project.

## Add-on Info

## Creating a project

Some content here.
`;

describe('upsert', () => {
	it('returns a function', () => {
		const fn = upsert('## Add-on Info > drizzle', ['Run `npm run db:push`']);
		expect(typeof fn).toBe('function');
	});

	it('appends sub-section to empty parent', () => {
		const result = upsert('## Add-on Info > drizzle', [
			'Run `npm run db:push` to update your database schema'
		])(README);

		expect(result).toContain('### drizzle');
		expect(result).toContain('- Run `npm run db:push` to update your database schema');
		expect(result).toContain('## Add-on Info');
		expect(result).toContain('## Creating a project');
	});

	it('appends multiple sub-sections', () => {
		let content = README;
		content = upsert('## Add-on Info > drizzle', ['Run `npm run db:push`'])(content);
		content = upsert('## Add-on Info > playwright', ['Run `npx playwright install`'])(content);

		expect(content).toContain('### drizzle');
		expect(content).toContain('### playwright');
		expect(content.indexOf('### drizzle')).toBeLessThan(content.indexOf('### playwright'));
	});

	it('replaces existing sub-section (upsert)', () => {
		let content = README;
		content = upsert('## Add-on Info > drizzle', ['Old step'])(content);
		content = upsert('## Add-on Info > drizzle', ['New step'])(content);

		expect(content).toContain('- New step');
		expect(content).not.toContain('- Old step');
		expect(content.match(/### drizzle/g)).toHaveLength(1);
	});

	it('replaces sub-section without affecting others', () => {
		let content = README;
		content = upsert('## Add-on Info > drizzle', ['Drizzle step'])(content);
		content = upsert('## Add-on Info > playwright', ['Playwright step'])(content);
		content = upsert('## Add-on Info > drizzle', ['Updated drizzle step'])(content);

		expect(content).toContain('- Updated drizzle step');
		expect(content).toContain('- Playwright step');
		expect(content).not.toContain('- Drizzle step');
	});

	it('returns content unchanged if parent missing', () => {
		const noSection = `# my-project\n\n## Developing\n`;
		const result = upsert('## Add-on Info > drizzle', ['Some step'])(noSection);
		expect(result).toBe(noSection);
	});

	it('returns content unchanged if lines array is empty', () => {
		const result = upsert('## Add-on Info > drizzle', [])(README);
		expect(result).toBe(README);
	});

	it('handles multiple lines per sub-section', () => {
		const result = upsert('## Add-on Info > drizzle', [
			'Run `npm run db:push`',
			'Check `DATABASE_URL` in `.env`'
		])(README);

		expect(result).toContain('- Run `npm run db:push`');
		expect(result).toContain('- Check `DATABASE_URL` in `.env`');
	});

	it('works when parent is at end of file', () => {
		const content = `# my-project\n\n## Add-on Info\n`;
		const result = upsert('## Add-on Info > drizzle', ['Some step'])(content);

		expect(result).toContain('### drizzle');
		expect(result).toContain('- Some step');
	});

	it('works with any section header', () => {
		const content = `# project\n\n## Custom Section\n\n## Other\n`;
		const result = upsert('## Custom Section > item', ['A line'])(content);

		expect(result).toContain('### item');
		expect(result).toContain('- A line');
		expect(result).toContain('## Other');
	});
});

describe('removeIfEmpty', () => {
	it('removes empty section', () => {
		const result = removeIfEmpty('## Add-on Info')(README);
		expect(result).not.toContain('## Add-on Info');
		expect(result).toContain('## Creating a project');
	});

	it('keeps section with sub-sections', () => {
		const withAddon = upsert('## Add-on Info > drizzle', ['Some step'])(README);
		const result = removeIfEmpty('## Add-on Info')(withAddon);
		expect(result).toContain('## Add-on Info');
		expect(result).toContain('### drizzle');
	});

	it('returns content unchanged if section not present', () => {
		const noSection = `# my-project\n\n## Developing\n`;
		const result = removeIfEmpty('## Add-on Info')(noSection);
		expect(result).toBe(noSection);
	});

	it('removes section at end of file', () => {
		const content = `# sv\n\n## Add-on Info\n`;
		const result = removeIfEmpty('## Add-on Info')(content);
		expect(result).not.toContain('## Add-on Info');
	});
});
