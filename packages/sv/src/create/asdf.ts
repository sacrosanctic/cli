import path from 'node:path';
import * as find from 'empathic/find';
import { generate_template } from './build-new-template.ts';

const SV_ROOT = path.dirname(find.up('package.json', { cwd: import.meta.dirname })!);
const TEMPLATES_DIR = path.resolve(SV_ROOT, 'src', 'create', 'templates', 'demo');

generate_template(TEMPLATES_DIR, path.join(SV_ROOT, 'dist', 'template'));
