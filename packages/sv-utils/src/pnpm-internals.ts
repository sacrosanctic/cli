import { execSync } from 'node:child_process';
import os from 'node:os';
import { coerceVersion } from './semver.ts';

export function detectPnpmMajor(): number | undefined {
	try {
		const out = execSync('pnpm --version', {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			cwd: os.tmpdir()
		});
		return coerceVersion(out.trim()).major;
	} catch {
		return undefined;
	}
}
