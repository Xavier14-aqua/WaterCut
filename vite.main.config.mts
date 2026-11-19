import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config
export default defineConfig({resolve:{alias:[{find:/^mediainfo\.js$/,replacement:fileURLToPath(new URL('./node_modules/mediainfo.js/dist/cjs/index.cjs',import.meta.url))}]}});
