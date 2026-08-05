import process from 'node:process';
import { exec } from 'tinyexec';

export function commandExists(command: string): boolean {
	const cmd = process.platform === 'win32' ? 'where' : 'command -v';
	try {
		return exec(cmd, [command]).exitCode === 0;
	} catch {
		return false;
	}
}
