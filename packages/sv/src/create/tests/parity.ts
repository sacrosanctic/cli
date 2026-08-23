import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { type LanguageType, type TemplateType, create } from '../index.ts';

// Resolve the given path relative to the current file
const resolve_path = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// use a directory outside of packages to ensure it isn't added to the pnpm workspace
const test_workspace_dir = resolve_path('../../../../../.test-output/create-parity/');

const baseline = JSON.parse(
	fs.readFileSync(resolve_path('./fixtures/scaffold-baseline.json'), 'utf8')
) as Record<string, Record<string, string>>;

const templates = ['minimal', 'demo', 'library', 'addon'] as TemplateType[];
const language_types = ['typescript', 'checkjs', 'none'] as LanguageType[];

function walk(dir: string, base = dir, out: Record<string, string> = {}) {
	for (const entry of fs.readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (fs.statSync(full).isDirectory()) {
			walk(full, base, out);
		} else {
			const rel = path.relative(base, full).replaceAll('\\', '/');
			out[rel] = fs.readFileSync(full, 'utf8');
		}
	}
	return out;
}

describe('scaffold output parity', () => {
	for (const template of templates) {
		for (const types of language_types) {
			test(`${template}-${types}`, () => {
				const cwd = path.join(test_workspace_dir, `${template}-${types}`);
				fs.rmSync(cwd, { recursive: true, force: true });

				create({ cwd, name: 'parity', template, types });

				expect(walk(cwd)).toEqual(baseline[`${template}-${types}` as keyof typeof baseline]);
			});
		}
	}
});
