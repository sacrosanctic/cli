import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentName } from '@sveltejs/sv-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { addDevEnginesIfPnpm } from '../package-manager.ts';

describe('addDevEnginesIfPnpm', () => {
	const createdDirs: string[] = [];

	function createPackageJson(content: string): { dir: string; file: string } {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-dev-engines-'));
		createdDirs.push(dir);
		const file = path.join(dir, 'package.json');
		fs.writeFileSync(file, content);
		return { dir, file };
	}

	afterEach(() => {
		for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
		createdDirs.length = 0;
	});

	it('adds devEngines for pnpm projects', () => {
		const { dir, file } = createPackageJson('{\n\t"name": "test-app"\n}');
		addDevEnginesIfPnpm({ cwd: dir, packageManager: 'pnpm' });

		const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
		expect(pkg.devEngines).toEqual({
			runtime: { name: 'node', version: '^22.18.0', onFail: 'download' },
			packageManager: { name: 'pnpm', version: '^11.28.3', onFail: 'download' }
		});
	});

	it('preserves an existing devEngines field', () => {
		const existing = { runtime: { name: 'node', version: '^20.0.0', onFail: 'fail' } };
		const { dir, file } = createPackageJson(
			JSON.stringify({ name: 'test-app', devEngines: existing }, null, '\t')
		);
		addDevEnginesIfPnpm({ cwd: dir, packageManager: 'pnpm' });

		const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
		expect(pkg.devEngines).toEqual(existing);
	});

	it('does nothing for other package managers', () => {
		const original = '{\n\t"name": "test-app"\n}';

		for (const packageManager of ['npm', 'yarn', 'bun', 'deno', null, undefined] as Array<
			AgentName | null | undefined
		>) {
			const { dir, file } = createPackageJson(original);
			addDevEnginesIfPnpm({ cwd: dir, packageManager });
			expect(fs.readFileSync(file, 'utf-8')).toEqual(original);
		}
	});
});
