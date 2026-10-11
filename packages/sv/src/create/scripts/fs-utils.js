// @ts-check
import fs from 'node:fs';

/**
 * Shared filesystem helpers for the build scripts in this directory
 * (`build-templates.js`, `build-addon-content.js`).
 *
 * Build-only: runtime code must use `src/create/utils.ts` instead, so the
 * build and runtime implementations stay decoupled.
 *
 * @param {string} dir
 */
export function mkdirp(dir) {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (e) {
		if (/** @type {any} */ (e).code === 'EEXIST') return;
		throw e;
	}
}
