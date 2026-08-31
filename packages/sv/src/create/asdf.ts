import path from 'node:path';
import * as find from 'empathic/find';
import { generate_templates } from './build-new-template.ts';

const SV_ROOT = path.dirname(find.up('package.json', { cwd: import.meta.dirname })!);
const TEMPLATES_DIR = path.resolve(
	SV_ROOT,
	'packages',
	'sv',
	'src',
	'create',
	'templates',
	'minimal'
);

generate_templates(TEMPLATES_DIR, 'dist/template');
