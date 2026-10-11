import fs from 'node:fs';
import path from 'node:path';
import {
	type AstTypes,
	Walker,
	downloadJson,
	isVersionUnsupportedBelow,
	parse,
	svelte,
	svelteConfig,
	transforms
} from '@sveltejs/sv-utils';
import { type Addon, defineAddon, defineAddonOptions } from '../core/config.ts';
import type { AddonOptions } from '../core/options.ts';
import { dist } from '../create/utils.ts';

// ============================================================================
// Pure playground logic (no filesystem, no workspace). Also imported by
// `sv create` for validation and the external-dependency confirmation prompt.
// ============================================================================

export function validatePlaygroundUrl(link: string): boolean {
	try {
		const url = new URL(link);
		if (url.hostname !== 'svelte.dev' || !url.pathname.startsWith('/playground/')) {
			return false;
		}

		const { playgroundId, hash } = parsePlaygroundUrl(link);
		return playgroundId !== undefined || hash !== undefined;
	} catch {
		// new Url() will throw if the URL is invalid
		return false;
	}
}

export type PlaygroundURL = {
	playgroundId?: string;
	hash?: string;
	svelteVersion?: string;
};

export function parsePlaygroundUrl(link: string): PlaygroundURL {
	const url = new URL(link);
	const [, playgroundId] = url.pathname.match(/\/playground\/([^/]+)/) || [];
	const hash = url.hash !== '' ? url.hash.slice(1) : undefined;
	const svelteVersion = url.searchParams.get('version') || undefined;

	return { playgroundId, hash, svelteVersion };
}

export type PlaygroundData = {
	name: string;
	files: Array<{ name: string; content: string }>;
	svelteVersion?: string;
};

export async function downloadPlaygroundData({
	playgroundId,
	hash,
	svelteVersion
}: PlaygroundURL): Promise<PlaygroundData> {
	let data = [];
	// forked playgrounds have a playground_id and an optional hash.
	// usually the hash is more up to date so take the hash if present.
	if (hash) {
		data = JSON.parse(await decodeAndDecompressText(hash));
	} else {
		data = await downloadJson(`https://svelte.dev/playground/api/${playgroundId}.json`);
	}

	// saved playgrounds and playground hashes have a different structure
	// therefore we need to handle both cases.
	const files = data.components !== undefined ? data.components : data.files;
	return {
		name: data.name,
		files: files.map((file: { name: string; type: string; contents: string; source: string }) => {
			return {
				name: file.name + (file.type !== 'file' ? `.${file.type}` : ''),
				content: file.source || file.contents
			};
		}),
		svelteVersion
	};
}

// Taken from https://github.com/sveltejs/svelte.dev/blob/ba7ad256f786aa5bc67eac3a58608f3f50b59e91/apps/svelte.dev/src/routes/(authed)/playground/%5Bid%5D/gzip.js#L19-L29
async function decodeAndDecompressText(input: string) {
	const decoded = atob(input.replaceAll('-', '+').replaceAll('_', '/'));
	// putting it directly into the blob gives a corrupted file
	const u8 = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i++) {
		u8[i] = decoded.charCodeAt(i);
	}
	const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Response(stream).text();
}

/**
 * @returns A Map of packages with it's name as the key, and it's version as the value.
 */
export function detectPlaygroundDependencies(files: PlaygroundData['files']): Map<string, string> {
	const packages = new Map<string, string>();

	// Prefixes for packages that should be excluded (built-in or framework packages)
	const excludedPrefixes = [
		'$', // SvelteKit framework imports
		'#', // subpath imports from the project itself
		'node:', // Node.js built-in modules
		'svelte', // Svelte core packages
		'@sveltejs/' // All SvelteKit packages
	];

	for (const file of files) {
		let ast: AstTypes.Program | undefined;
		if (file.name.endsWith('.svelte')) {
			const { ast: svelteAst } = parse.svelte(file.content);
			svelte.ensureScript(svelteAst);
			ast = svelteAst.instance.content;
		} else if (file.name.endsWith('.js') || file.name.endsWith('.ts')) {
			ast = parse.script(file.content).ast;
		}
		if (!ast) continue;

		const imports = ast.body
			.filter((node): node is AstTypes.ImportDeclaration => node.type === 'ImportDeclaration')
			.map((node) => node.source.value as string)
			.filter((importPath) => !importPath.startsWith('./') && !importPath.startsWith('/'))
			.filter((importPath) => !excludedPrefixes.some((prefix) => importPath.startsWith(prefix)))
			.map(extractPackageInfo);

		imports.forEach(({ pkgName, version }) => packages.set(pkgName, version));
	}

	return packages;
}

/**
 * Extracts a package's name and it's versions from a provided import path.
 *
 * Handles imports with or without subpaths (e.g. `pkg-name/subpath`, `@org/pkg-name/subpath`)
 * as well as specified versions (e.g. pkg-name@1.2.3).
 */
function extractPackageInfo(importPath: string): { pkgName: string; version: string } {
	let pkgName = '';

	// handle scoped deps
	if (importPath.startsWith('@')) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const [org, pkg, _subpath] = importPath.split('/', 3);
		pkgName = `${org}/${pkg}`;
	}

	if (!pkgName) {
		[pkgName] = importPath.split('/', 2);
	}

	const version = extractPackageVersion(pkgName);
	// strips the package's version from the name, if present
	if (version !== 'latest') pkgName = pkgName.replace(`@${version}`, '');
	return { pkgName, version };
}

function extractPackageVersion(pkgName: string) {
	let version = 'latest';
	// e.g. `pkg-name@1.2.3` (starting from index 1 to ignore the first `@` in scoped packages)
	if (pkgName.includes('@', 1)) {
		[, version] = pkgName.split('@');
	}
	return version;
}

/**
 * Downloads (once per URL) and detects the external dependencies of a playground.
 * `sv create` calls this up front for the dependency confirmation prompt; the
 * add-on's `run` reuses the cached entry so the playground is fetched only once.
 */
export async function preparePlayground(url: string): Promise<{
	playground: PlaygroundData;
	dependencies: Map<string, string>;
}> {
	const cached = playgroundCache.get(url);
	if (cached) return cached;

	const entry = {
		playground: await downloadPlaygroundData(parsePlaygroundUrl(url)),
		dependencies: new Map<string, string>()
	};
	entry.dependencies = detectPlaygroundDependencies(entry.playground.files);
	playgroundCache.set(url, entry);
	return entry;
}

const playgroundCache = new Map<
	string,
	{ playground: PlaygroundData; dependencies: Map<string, string> }
>();

// ============================================================================
// Add-on (workspace mutation via `SvApi`; internal-only, called by `sv create`)
// ============================================================================

export type PlaygroundOptions = {
	url: string;
	installDeps: boolean;
};

const options = defineAddonOptions<PlaygroundOptions>()
	.add('url', {
		question: 'Which playground should the project be created from?',
		type: 'string',
		default: '',
		validate: (value) => {
			if (value && validatePlaygroundUrl(value)) return undefined;
			return new Error('Expected a valid `svelte.dev/playground/...` URL');
		}
	})
	.add('installDeps', {
		question: 'Do you want to install the external dependencies found in the playground?',
		type: 'boolean',
		default: false
	})
	.build();

function renderPlaygroundLayout(contents: string, name: string, url: string): string {
	const { ast, generateCode } = parse.svelte(contents);
	svelte.ensureScript(ast);
	// tsgo can't infer visitor node types from zimmerframe's distributive conditional
	Walker.walk(ast.instance.content as AstTypes.Node, null, {
		Literal(node) {
			if (node.value === '$sv-title-$sv') {
				node.value = name;
				node.raw = undefined;
			} else if (node.value === '$sv-url-$sv') {
				node.value = url;
				node.raw = undefined;
			}
		}
	});
	return generateCode();
}

const addon: Addon<AddonOptions<PlaygroundOptions>, 'playground'> = defineAddon({
	id: 'playground',
	shortDescription: 'scaffold from a svelte playground',
	homepage: 'https://svelte.dev/playground',
	hidden: true,
	options,
	setup: ({ unsupported, isKit }) => {
		if (!isKit) unsupported('Playground projects require SvelteKit');
	},
	run: async ({ sv, cwd, options, directory, language, cancel }) => {
		const { playground, dependencies } = await preparePlayground(options.url);

		const mainFile = playground.files.find((file) => file.name === 'App.svelte');
		if (!mainFile) return cancel('Failed to find `App.svelte` entrypoint.');

		for (const file of playground.files) {
			let content = file.content;
			for (const [pkg, version] of dependencies) {
				// if a version was specified, we'll remove it from all import paths
				if (version !== 'latest') {
					content = content.replaceAll(`${pkg}@${version}`, pkg);
				}
			}
			sv.file(`${directory.lib}/playground/${file.name}`, () => content);
		}

		// add playground shared files
		const { files } = JSON.parse(
			fs.readFileSync(dist(path.join('addons', 'playground.json')), 'utf-8')
		) as {
			files: Array<{ name: string; contents: string }>;
		};
		for (const file of files) {
			let contentToWrite = file.contents;
			if (file.name === 'src/lib/PlaygroundLayout.svelte') {
				contentToWrite = renderPlaygroundLayout(file.contents, playground.name, options.url);
			}
			sv.file(file.name, () => contentToWrite);
		}

		// render the playground app inside the layout on the index page
		sv.file(
			`${directory.kitRoutes}/+page.svelte`,
			transforms.svelteScript({ language }, ({ ast, svelte, js }) => {
				js.imports.addDefault(ast.instance.content, {
					as: 'App',
					from: `#lib/playground/${mainFile.name}`
				});
				js.imports.addDefault(ast.instance.content, {
					as: 'PlaygroundLayout',
					from: `#lib/PlaygroundLayout.svelte`
				});
				svelte.addFragment(
					ast,
					`<PlaygroundLayout>
		<App />
	</PlaygroundLayout>`
				);
			})
		);

		if (options.installDeps) {
			for (const [dep, version] of dependencies) {
				sv.dependency(dep, version);
			}
		}

		let experimentalAsyncNeeded = true;

		// we want to change the svelte version, even if the user decided
		// to not install external dependencies
		if (playground.svelteVersion) {
			// from https://github.com/sveltejs/svelte.dev/blob/ba7ad256f786aa5bc67eac3a58608f3f50b59e91/packages/repl/src/lib/workers/npm.ts#L14
			const pkgPrNewRegex = /^(pr|commit|branch)-(.+)/;
			const match = pkgPrNewRegex.exec(playground.svelteVersion);
			const version = match
				? `https://pkg.pr.new/svelte@${match[2]}`
				: `${playground.svelteVersion}`;
			sv.devDependency('svelte', version);

			// if the version is a "pkg.pr.new" version, we don't need to check for support, we will use the fallback
			if (!version.includes('pkg.pr.new')) {
				const unsupported = isVersionUnsupportedBelow(version, '5.36');
				if (unsupported) experimentalAsyncNeeded = false;
			}
		}

		if (experimentalAsyncNeeded) {
			// `compilerOptions` is a svelte-level option, so it goes on `config` regardless of whether
			// the config lives in `svelte.config.js` or inside `sveltekit()` in `vite.config.js`.
			svelteConfig.edit({ sv, cwd }, ({ override }) => {
				override({ compilerOptions: { experimental: { async: true } } });
			});
		}
	}
});

export default addon;
