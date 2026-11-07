import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
	basename,
	dirname,
	join,
	matchesGlob,
	relative,
	resolve,
	test_internals,
	type RootedDirectoryPath,
	type RootedFilePath,
	type RootedPath,
	rooted_dir,
	rooted_file,
	rooted_path,
	to_posix
} from '../path.ts';

/**
 * The relative boundary constructor is deliberately not public: downstream
 * code never builds `RelativePath`s itself, `resolve`/`join` convert segments
 * in place. The tests reach it through the internals surface.
 */
const { relative_path } = test_internals;

/** The platform root, e.g. `/` on posix and `C:\` on Windows. */
const FS_ROOT = path.parse(path.resolve('/')).root;
/** An absolute test directory on the current platform, e.g. `/work/project` or `C:\work\project`. */
const PROJECT_DIR = path.resolve(FS_ROOT, 'work', 'project');

describe('rooted_path', () => {
	it('normalizes redundant segments, mixed separators and trailing separators', () => {
		const input = `${PROJECT_DIR.replace(/\\/g, '/')}/src/./lib/../..`;
		expect(rooted_path(input)).toEqual(PROJECT_DIR);
		expect(rooted_path(`${PROJECT_DIR}${path.sep}${path.sep}`)).toEqual(PROJECT_DIR);
	});

	it('accepts the filesystem root itself', () => {
		expect(rooted_path(FS_ROOT)).toEqual(FS_ROOT);
	});

	it('clamps `..` segments that reach above the root, staying rooted', () => {
		expect(rooted_path(`${PROJECT_DIR}/src/./..`)).toEqual(PROJECT_DIR);
		expect(rooted_path(`${FS_ROOT}src/./..`)).toEqual(FS_ROOT);
	});

	it('throws on relative input', () => {
		expect(() => rooted_path('src/lib')).toThrowError(/rooted \(absolute\) path/);
	});
});

describe('rooted_file and rooted_dir', () => {
	it('return the same string as rooted_path, with file/directory intent', () => {
		expect(rooted_file(path.join(PROJECT_DIR, 'index.ts'))).toEqual(
			path.join(PROJECT_DIR, 'index.ts')
		);
		expect(rooted_dir(PROJECT_DIR)).toEqual(PROJECT_DIR);
	});

	it('validate just like rooted_path', () => {
		expect(() => rooted_file('index.ts')).toThrowError();
		expect(() => rooted_dir('work/project')).toThrowError();
	});
});

describe('resolve', () => {
	it('matches node:path, relative segments are anchored at the dir', () => {
		expect(resolve(rooted_dir(PROJECT_DIR), 'src', 'lib')).toEqual(
			path.resolve(PROJECT_DIR, 'src', 'lib')
		);
		expect(resolve(rooted_dir(PROJECT_DIR), '../above')).toEqual(
			path.resolve(PROJECT_DIR, '../above')
		);
	});

	it('rebases onto absolute segments like node:path', () => {
		const elsewhere = path.resolve(FS_ROOT, 'elsewhere');
		expect(resolve(rooted_dir(PROJECT_DIR), elsewhere, 'file.txt')).toEqual(
			path.resolve(PROJECT_DIR, elsewhere, 'file.txt')
		);
	});

	it('strips trailing separators that would break the RootedPath invariant', () => {
		expect(resolve(rooted_dir(PROJECT_DIR), `src${path.sep}`)).toEqual(
			path.join(PROJECT_DIR, 'src')
		);
	});

	it('accepts posix-spelled segments, results match node:path', () => {
		// a `RelativePath` is always posix-spelled; the win32 implementations
		// treat `/` as a first-class separator and normalize the whole result,
		// so no separator mapping is needed before handing segments to node:path
		const posix_relative = relative_path('src/lib');
		expect(resolve(rooted_dir(PROJECT_DIR), posix_relative, 'file.ts')).toEqual(
			path.resolve(PROJECT_DIR, 'src', 'lib', 'file.ts')
		);
		expect(join(rooted_dir(PROJECT_DIR), posix_relative)).toEqual(
			path.join(PROJECT_DIR, 'src', 'lib')
		);
	});

	it('rejects drive-relative segments that would anchor at the per-drive cwd', () => {
		expect(() => resolve(rooted_dir(PROJECT_DIR), 'C:work')).toThrowError(/drive-relative/);
	});

	it('rejects drive-relative fragments under evasive spellings, like node:path silently mangles', () => {
		// node resolves `./C:work` onto the dir verbatim, yielding `...\project\C:work`
		expect(() => resolve(rooted_dir(PROJECT_DIR), './C:work')).toThrowError(
			/drive-relative fragment/
		);
		// node drops the `C:` of `C:work/./x`, yielding `...\project\work\x`
		expect(() => resolve(rooted_dir(PROJECT_DIR), 'src/../C:work')).toThrowError(
			/drive-relative fragment/
		);
		expect(() => resolve(rooted_dir(PROJECT_DIR), `src${path.sep}C:work`)).toThrowError(
			/drive-relative fragment/
		);
		expect(() => join(rooted_dir(PROJECT_DIR), './C:work')).toThrowError(/drive-relative fragment/);
	});
});

describe('relative_path (via test_internals)', () => {
	it('normalizes separators and redundant segments', () => {
		expect(relative_path('src\\./lib')).toEqual('src/lib');
		expect(relative_path('src/')).toEqual('src');
	});

	it('rejects rooted input on any platform spelling', () => {
		expect(() => relative_path('C:/work')).toThrowError(/relative path/);
		expect(() => relative_path('/work')).toThrowError(/relative path/);
	});

	it('rejects Windows drive-relative spellings, however they arrive', () => {
		expect(() => relative_path('C:work')).toThrowError(/drive-relative fragment/);
		expect(() => relative_path('C:')).toThrowError(/drive-relative fragment/);
		// `./C:work` normalizes into a leading fragment, `src\C:work` is one
		expect(() => relative_path('./C:work')).toThrowError(/drive-relative fragment/);
		expect(() => relative_path('src\\C:work')).toThrowError(/drive-relative fragment/);
		// `..` absorbs `src` and leaves the fragment at the start
		expect(() => relative_path('src/../C:work')).toThrowError(/drive-relative fragment/);
	});

	it('rejects nowhere-pointing and workspace-escaping input', () => {
		expect(() => relative_path('')).toThrowError(/non-empty/);
		expect(() => relative_path('.')).toThrowError(/not `.`/);
		expect(() => relative_path('../work')).toThrowError(/escapes out of the workspace/);
		expect(() => relative_path('..')).toThrowError(/escapes out of the workspace/);
	});
});

describe('join', () => {
	it('joins segments into a rooted path without trailing separators', () => {
		expect(join(rooted_dir(PROJECT_DIR), 'src', `lib${path.sep}${path.sep}${path.sep}`)).toEqual(
			path.join(PROJECT_DIR, 'src', 'lib')
		);
	});

	it('skips empty segments', () => {
		expect(join(rooted_dir(PROJECT_DIR), '', 'src', '', 'lib', '')).toEqual(
			path.join(PROJECT_DIR, 'src', 'lib')
		);
	});

	it('resolves interior `..` segments', () => {
		expect(join(rooted_dir(path.join(PROJECT_DIR, 'src')), '..', 'lib')).toEqual(
			path.join(PROJECT_DIR, 'lib')
		);
	});

	it('does not rebase like resolve, rejecting rooted segments instead', () => {
		const elsewhere = path.resolve(FS_ROOT, 'elsewhere');
		expect(resolve(rooted_dir(PROJECT_DIR), elsewhere, 'file.txt')).toEqual(
			path.resolve(elsewhere, 'file.txt')
		);
		// `node:path.join` would merely concatenate a rooted segment into a
		// malformed path (`...\\project\\C:\\elsewhere`), so `join` rejects it
		expect(() => join(rooted_dir(PROJECT_DIR), elsewhere)).toThrowError(/rooted input/);
		expect(() => join(rooted_dir(PROJECT_DIR), 'C:work')).toThrowError(/drive-relative/);
	});
});

describe('dirname', () => {
	it('returns the rooted directory of a rooted file', () => {
		expect(dirname(rooted_file(path.join(PROJECT_DIR, 'src', 'index.ts')))).toEqual(
			path.join(PROJECT_DIR, 'src')
		);
	});

	it('of a filesystem root is the root itself', () => {
		expect(dirname(rooted_dir(FS_ROOT))).toEqual(FS_ROOT);
	});
});

describe('basename', () => {
	it('returns the last segment', () => {
		expect(basename(rooted_file(path.join(PROJECT_DIR, 'src', 'index.ts')))).toEqual('index.ts');
		expect(basename(rooted_dir(path.join(PROJECT_DIR, 'src')))).toEqual('src');
	});

	it('strips the given extension', () => {
		expect(basename(rooted_file(path.join(PROJECT_DIR, 'src', 'index.ts')), '.ts')).toEqual(
			'index'
		);
	});
});

describe('relative', () => {
	it('matches node:path for rooted inputs', () => {
		const lib = rooted_path(path.join(PROJECT_DIR, 'src', 'lib'));
		expect(relative(rooted_dir(PROJECT_DIR), lib)).toEqual(
			to_posix(path.relative(PROJECT_DIR, path.join(PROJECT_DIR, 'src', 'lib')))
		);
	});

	it("returns '.' when `to` is `from` itself", () => {
		expect(relative(rooted_dir(PROJECT_DIR), rooted_dir(PROJECT_DIR))).toEqual('.');
	});

	it(
		'throws a diagnostic error for locations that share no root',
		{
			// only Windows can spell two locations whose roots are unrelated
			skip: process.platform !== 'win32'
		},
		() => {
			expect(() => relative(rooted_dir(PROJECT_DIR), rooted_path('Z:\\elsewhere'))).toThrowError(
				/share no root/
			);
		}
	);

	it('returns an escaping `..` chain when the to path leaves the base', () => {
		expect(relative(rooted_dir(path.join(PROJECT_DIR, 'src')), rooted_dir(PROJECT_DIR))).toEqual(
			to_posix(path.relative(path.join(PROJECT_DIR, 'src'), PROJECT_DIR))
		);
	});
});

describe('matchesGlob', () => {
	it('matches file paths, separators matching the input spelling', () => {
		expect(matchesGlob(relative_path('src/file.ts'), 'src/*.ts')).toBe(true);
	});

	it('returns false for non-matching patterns', () => {
		expect(matchesGlob(relative_path('src/file.ts'), 'src/*.json')).toBe(false);
	});

	it('arrives at the rooted full path via a full-path pattern', () => {
		expect(
			matchesGlob(
				rooted_file(path.join(PROJECT_DIR, 'src', 'file.ts')),
				`**${path.sep}src${path.sep}*.ts`
			)
		).toBe(true);
	});
});

describe('brand hierarchy', () => {
	const file = path.join(PROJECT_DIR, 'index.ts');

	it('stacked brands are inhabited, not collapsed to never', () => {
		// only compiles if `RootedFilePath` is a real string subtype
		const branded: RootedFilePath = rooted_file(file);
		expect(typeof branded).toEqual('string');
	});

	it('a child brand is assignable to its parent brand', () => {
		// only compiles because `RootedFilePath` carries the `RootedPath` marker
		const as_rooted: RootedPath = rooted_file(file);
		expect(typeof as_rooted).toEqual('string');
	});

	it('a parent brand is not assignable to a child brand', () => {
		const parent = rooted_path(file);
		expect(typeof parent).toEqual('string');
		// @ts-expect-error - `RootedPath` lacks the `RootedFilePath` marker
		const not_file: RootedFilePath = parent;
		expect(typeof not_file).toEqual('string');
	});

	it('sibling brands are distinct', () => {
		const file_path = rooted_file(file);
		expect(typeof file_path).toEqual('string');
		// @ts-expect-error - `RootedFilePath` lacks the `RootedDirectoryPath` marker
		const not_directory: RootedDirectoryPath = file_path;
		expect(typeof not_directory).toEqual('string');
	});
});
