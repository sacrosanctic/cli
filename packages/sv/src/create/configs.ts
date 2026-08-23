import type { LanguageType, TemplateType } from './index.ts';

export type ConfigFile = {
	name: string;
	contents: string;
};

export type PackageJsonEdits = {
	scripts?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

const KIT_CONFIG_JSON = `{
\t"extends": "$app/tsconfig",
\t"compilerOptions": {
\t\t"strict": true
\t},
\t"include": ["src", "vite.config.ts"]
}
`;

// the add-on template is a plain Node package (no SvelteKit), so it cannot extend '$app/tsconfig'
const ADDON_CONFIG_JSON = `{
\t"compilerOptions": {
\t\t"strict": true,
\t\t"skipLibCheck": true,
\t\t"checkJs": true,
\t\t"module": "NodeNext",
\t\t"moduleResolution": "NodeNext"
\t}
}
`;

export function getTypeCheckingFiles(
	template: TemplateType,
	types: LanguageType
): ConfigFile[] {
	if (types === 'typescript') {
		return [{ name: 'tsconfig.json', contents: KIT_CONFIG_JSON }];
	}

	const contents = template === 'addon' ? ADDON_CONFIG_JSON : KIT_CONFIG_JSON;
	return [{ name: 'jsconfig.json', contents }];
}

export function getTypeCheckingPackageJsonEdits(types: LanguageType): PackageJsonEdits | undefined {
	if (types === 'none') return;

	const config = types === 'typescript' ? 'tsconfig.json' : 'jsconfig.json';
	return {
		scripts: {
			check: `svelte-kit sync && svelte-check --tsconfig ./${config}`,
			'check:watch': `svelte-kit sync && svelte-check --tsconfig ./${config} --watch`
		},
		devDependencies: {
			'svelte-check': '^4.6.0',
			typescript: '^6.0.3'
		}
	};
}
