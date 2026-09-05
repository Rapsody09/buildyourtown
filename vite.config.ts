import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // exposed to the app as __APP_VERSION__ (shown in the status bar)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
