import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  outDir: process.env.WATERCUT_BUILD_OUT || 'out',
  packagerConfig: {
    asar: true,
    extraResource: ['LICENSE', 'THIRD_PARTY_NOTICES.txt', '.build-resources/MediaInfoModule.wasm', '.build-resources/build-info.json'],
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        { entry: 'src/workers/probe-worker.ts', config: 'vite.main.config.mts', target: 'main' },
        {
          entry: 'src/workers/data-worker.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
};

export default config;
