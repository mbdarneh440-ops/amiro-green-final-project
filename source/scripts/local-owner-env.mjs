import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const allowed = ['MAKE_API_TOKEN', 'MAKE_ZONE', 'MAKE_DATA_STORE_ID', 'MAKE_INBOX_WEBHOOK_SECRET', 'INBOX_OWNER_ID', 'AI_API_KEY', 'AI_MODEL', 'MAKE_SYNC_ENABLED', 'COMPANY_MAILBOX', 'AI_ENABLED'];

// An optional ignored pointer stores only a local filename. Credentials remain
// in the owner's private file, outside submission folders and client bundles.
export function readLocalEnvironment(projectRoot) {
  const pointer = path.join(projectRoot, '.sites-runtime', 'owner-env-path.txt');
  let file = path.join(projectRoot, '.env');
  const external = existsSync(pointer);
  if (external) {
    let selected;
    try { selected = readFileSync(pointer, 'utf8').replace(/^\uFEFF/, '').trim(); }
    catch { throw new Error('The private owner environment pointer cannot be read.'); }
    if (!selected || /[\r\n\u0000]/.test(selected) || !path.isAbsolute(selected)) {
      throw new Error('The private owner environment pointer must contain one absolute file path.');
    }
    file = selected;
  }
  let parsed = {};
  try {
    if (external && !statSync(file).isFile()) throw new Error('Not a file');
    if (external || existsSync(file)) parsed = parseEnv(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    // Never include secret values or file contents in diagnostics.
    throw new Error(external ? 'The private owner environment file is missing or unreadable.' : 'The local environment file cannot be read.');
  }
  const values = { MAKE_SYNC_ENABLED: 'false', AI_ENABLED: 'false' };
  for (const key of allowed) if (Object.hasOwn(parsed, key)) values[key] = parsed[key];
  return values;
}

// Getters also work when the launcher's original bindings are frozen. The
// database and every unrelated binding retain their original identity.
export function createLiveEnvironment(bindings, projectRoot) {
  if (!bindings) throw new Error('Start the local Node server through the project launcher.');
  const live = Object.create(null);
  for (const key of Reflect.ownKeys(bindings)) {
    if (!allowed.includes(key)) Object.defineProperty(live, key, { enumerable: true, value: bindings[key] });
  }
  for (const key of allowed) {
    Object.defineProperty(live, key, { enumerable: true, get() { return readLocalEnvironment(projectRoot)[key]; } });
  }
  return Object.freeze(live);
}
