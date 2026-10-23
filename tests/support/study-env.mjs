import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../../worker/index.js';

export function environment({ migrateStudy = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = new URL('../../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql') && (migrateStudy || !name.startsWith('0007'))).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const DB = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      return { bind(...values) { return {
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return { meta: { changes: statement.run(...values).changes } }; },
      }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map();
  const BUCKET = {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(key) { objects.delete(key); },
  };
  return { DB, BUCKET, sqlite, objects };
}
export function request(path, { method = 'GET', body, owner = 'study-owner', origin = 'https://site.test' } = {}) {
  const headers = new Headers({ Origin: origin });
  if (owner) { headers.set('oai-authenticated-user-id', owner); headers.set('oai-authenticated-user-email', `${owner}@test.invalid`); }
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return new Request(`https://site.test${path}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}
export const call = async (env, path, options) => {
  const response = await handleApi(request(path, options), env);
  return { status: response.status, data: await response.json() };
};
