import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { createLiveEnvironment } from '../scripts/local-owner-env.mjs';

// This bridge is installed only for an explicit portable Node dev server.
// Cloud deployment continues to use real Cloudflare bindings.
export function localNodeBindings(): Plugin {
  const id = '\0wardiya-local-node-bindings';
  const rscHandler = new URL('../node_modules/vinext/dist/server/app-rsc-handler.js', import.meta.url).href;
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  return {
    name: 'wardiya:local-node-bindings',
    enforce: 'pre',
    configResolved(config) {
      // Configuration executes in Node. Install the live wrapper here, so the
      // RSC runner only reads the existing shared binding and needs no file URL
      // imports (which the installed beta mishandles for local Windows paths).
      const key = Symbol.for('wardiya.portable.node.env');
      const host = globalThis as typeof globalThis & Record<symbol, unknown>;
      if (host[key]) host[key] = createLiveEnvironment(host[key], projectRoot);
      // Vinext scans route files as browser entries even though they are server
      // endpoints. Exclude them from scanning, not from actual server routing.
      const client = config.environments.client?.optimizeDeps;
      if (client) {
        const entries = typeof client.entries === 'string' ? [client.entries] : client.entries ?? [];
        client.entries = [...entries, '!app/**/route.{ts,tsx,js,jsx}'];
      }
      // This installed beta references an unexported bare package subpath.
      // Resolve its existing implementation explicitly for portable Node only.
      const resolve = config.environments.rsc?.resolve;
      if (resolve && Array.isArray(resolve.external)) {
        resolve.external = resolve.external.filter(id => id !== 'vinext/server/app-rsc-handler');
      }
    },
    resolveId(source) {
      if (source === 'vinext/server/app-rsc-handler' || source === rscHandler) return { id: rscHandler, external: true };
      if (source === 'cloudflare:workers') {
        if (this.environment.name === 'client') this.error('Server bindings cannot be imported by the browser');
        return id;
      }
    },
    load(source) {
      if (source === id) return `export const env = globalThis[Symbol.for('wardiya.portable.node.env')]; if (!env) throw new Error('Start the local Node server through the project launcher.');`;
    },
  };
}
