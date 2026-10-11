import { mkdirp } from '../utils.ts';
import { build_kit_template } from './build-kit-template.js';
import { build_vite_template } from './build-vite-template.js';

/**
 * @param {string} dist
 */
export async function buildTemplates(dist) {
	mkdirp(dist);

	await build_kit_template(dist);
	build_vite_template(dist);
}
