import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { getLocalBindings } from './local-node-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sameRoot=process.platform==='win32'
  ? path.resolve(process.cwd()).toLowerCase()===path.resolve(root).toLowerCase()
  : path.resolve(process.cwd())===path.resolve(root);
if(!sameRoot)process.chdir(root);
process.env.WARDIYA_LOCAL_RUNTIME = 'node';
const index = process.argv.indexOf('--port');
const port = index < 0 ? 5173 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
// Apply the actual project schema before serving the actual App Router routes.
const bindings = getLocalBindings();
globalThis[Symbol.for('wardiya.portable.node.env')] = bindings;
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
server.printUrls();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  bindings.DB.close();
  process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
