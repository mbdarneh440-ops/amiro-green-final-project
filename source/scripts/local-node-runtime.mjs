import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLiveEnvironment } from './local-owner-env.mjs';
export { readLocalEnvironment } from './local-owner-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function createLocalDatabase(databasePath, migration) {
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  sqlite.exec(migration.replace(/CREATE TABLE\s+(?!IF NOT EXISTS\b)/gi, 'CREATE TABLE IF NOT EXISTS '));
  const value = (input) => {
    if (input === null || typeof input === 'string' || typeof input === 'number' || typeof input === 'bigint' || input instanceof Uint8Array) return input;
    if (typeof input === 'boolean') return Number(input);
    throw new TypeError('Unsupported local database binding');
  };
  function prepared(query, parameters = []) {
    const statement = sqlite.prepare(query);
    return {
      bind(...parameters) { return prepared(query, parameters.map(value)); },
      async first(column) {
        const row = statement.get(...parameters);
        return row ? (column === undefined ? { ...row } : row[column] ?? null) : null;
      },
      async run() {
        const result = statement.run(...parameters);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async all() { return { success: true, results: statement.all(...parameters).map(row => ({ ...row })), meta: {} }; },
      async raw(options) {
        statement.setReturnArrays(true);
        const rows = statement.all(...parameters);
        return options?.columnNames ? [statement.columns().map(column => column.name), ...rows] : rows;
      },
    };
  }
  return {
    prepare: prepared,
    async exec(query) { sqlite.exec(query); return { count: 0, duration: 0 }; },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}

export function getLocalBindings() {
  const key = Symbol.for('wardiya.portable.node.bindings');
  const cache = globalThis[key] ??= new Map();
  if (!cache.has(root)) {
    const runtime = path.join(root, '.sites-runtime');
    mkdirSync(runtime, { recursive: true });
    const migration = readFileSync(path.join(root, 'drizzle', '0000_outgoing_puma.sql'), 'utf8');
    const DB = createLocalDatabase(path.join(runtime, 'node-workspace.sqlite'), migration);
    cache.set(root, createLiveEnvironment(Object.freeze({ DB }), root));
  }
  return cache.get(root);
}
