import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// Escribe la versión de package.json en el nombre de la caché del service worker.
function serviceWorkerVersion() {
  let outDir = 'dist';
  return {
    name: 'service-worker-version',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      writeFileSync(file, readFileSync(file, 'utf-8').replaceAll('__APP_VERSION__', version));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerVersion()],
  base: '/euribor-hipoteca/',
});
