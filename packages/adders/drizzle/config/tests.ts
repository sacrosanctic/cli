import { options } from './options.ts';
import { defineAdderTests } from '@svelte-cli/core';
import { common } from '@svelte-cli/core/js';
import { addFromRawHtml } from '@svelte-cli/core/html';
import path from 'path';
import url from 'url';
import { execSync } from 'child_process';

const defaultOptionValues = {
	sqlite: options.sqlite.default,
	mysql: options.mysql.default,
	postgresql: options.postgresql.default,
	docker: options.docker.default
};

const cwd = path.resolve(url.fileURLToPath(import.meta.url), '..', '..');

export const tests = defineAdderTests({
	options,
	optionValues: [
		{ ...defaultOptionValues, database: 'sqlite', sqlite: 'better-sqlite3' },
		{ ...defaultOptionValues, database: 'sqlite', sqlite: 'libsql' },
		{ ...defaultOptionValues, database: 'mysql', mysql: 'mysql2', docker: true },
		{ ...defaultOptionValues, database: 'postgresql', postgresql: 'postgres.js', docker: true }
	],
	files: [
		{
			name: ({ kit }) => `${kit?.routesDirectory}/+page.svelte`,
			contentType: 'svelte',
			condition: ({ kit }) => Boolean(kit),
			content: ({ htmlAst, jsAst }) => {
				common.addFromString(jsAst, 'export let data;');
				addFromRawHtml(
					htmlAst.childNodes,
					`
                    {#each data.users as user}
                        <span data-test-id="user-id-{user.id}">{user.id} {user.name}</span>
                    {/each}
                    `
				);
			}
		},
		{
			name: ({ kit, typescript }) =>
				`${kit?.routesDirectory}/+page.server.${typescript ? 'ts' : 'js'}`,
			contentType: 'script',
			condition: ({ kit }) => Boolean(kit),
			content: ({ ast, typescript }) => {
				common.addFromString(
					ast,
					`
                    import { db } from '$lib/server/db';
                    import { user } from '$lib/server/db/schema.js';

                    export const load = async () => {
                        await insertUser({ name: 'Foobar', id: 0, age: 20 }).catch((err) => console.error(err));

                        const users = await db.select().from(user);

                        return { users };
                    };

                    function insertUser(${typescript ? 'value: typeof user.$inferInsert' : 'value'}) {
                        return db.insert(user).values(value);
                    }
                    `
				);
			}
		},
		{
			// override the config so we can remove strict mode
			name: ({ typescript }) => `drizzle.config.${typescript ? 'ts' : 'js'}`,
			contentType: 'text',
			condition: ({ kit }) => Boolean(kit),
			content: ({ content }) => {
				return content.replace('strict: true,', '');
			}
		},
		{
			name: () => 'package.json',
			contentType: 'json',
			content: ({ data }) => {
				// executes after pnpm install
				data.scripts['postinstall'] ??= 'pnpm run db:push';
			}
		}
	],
	beforeAll: startDocker,
	afterAll: stopDocker,
	tests: [
		{
			name: 'queries database',
			run: async ({ elementExists }) => {
				await elementExists('[data-test-id]');
			}
		}
	]
});

function startDocker() {
	console.log('Starting docker containers');
	execSync('docker compose up --detach', { cwd, stdio: 'pipe' });
}

function stopDocker() {
	console.log('Stopping docker containers');
	execSync('docker compose down --volumes', { cwd, stdio: 'pipe' });
}

process.on('exit', stopDocker);
process.on('SIGINT', stopDocker);
