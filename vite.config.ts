import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

const localConfig = fileURLToPath(new URL('./wrangler.local.jsonc', import.meta.url));

export default defineConfig(({ mode }) => ({
  // AI mode uses Cloudflare inference while the app and its other bindings stay local.
  // The default mode still boots without an account for offline use and tests.
  plugins: [cloudflare({ remoteBindings: mode === 'ai', ...(existsSync(localConfig) ? { configPath: localConfig } : {}) })],
  build: { target: 'es2022', sourcemap: true },
  environments: {
    client: {
      build: {
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
          input: { main: 'index.html', remote: 'remote.html' },
          // three.js + its post/camera libraries change far less often than app code: their own chunk stays cached
          // across deploys and downloads in parallel with main. Only the main page imports it (remote stays three-free).
          output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/](three|postprocessing|camera-controls)[\\/]/ }] } },
        },
      },
    },
    // Worker environment is named after wrangler "name" with '-' -> '_'.
    suspension_lab: { build: { sourcemap: true } },
  },
}));
