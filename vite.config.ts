import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';
import fs from 'fs';

const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version as string;

function getSyncedPreloadContent(): string {
  const typesPath = path.resolve(__dirname, 'shared/types/index.ts');
  const preloadPath = path.resolve(__dirname, 'electron/preload/main.cjs');
  const typesContent = fs.readFileSync(typesPath, 'utf-8');
  const preloadContent = fs.readFileSync(preloadPath, 'utf-8');
  const match = typesContent.match(/export const IPC_CHANNELS\s*=\s*(\{[\s\S]*?\})\s*as\s*const;/);
  if (!match) return preloadContent;

  const channelsBlock = `// This block is generated from shared/types/index.ts during build.\n// Edit IPC_CHANNELS in shared/types/index.ts, not this generated copy.\nconst IPC_CHANNELS = ${match[1]};`;

  return preloadContent.replace(
    /const IPC_CHANNELS\s*=\s*\{[\s\S]*?\n\};/,
    channelsBlock
  );
}

function copyPreloadPlugin(): Plugin {
  return {
    name: 'copy-preload',
    buildStart() {
      const destDir = path.resolve(__dirname, 'dist-electron');
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const files: Array<{ source: string; output: string; content?: string }> = [
        { source: 'main.cjs', output: 'preload.cjs', content: getSyncedPreloadContent() },
        { source: 'crop.cjs', output: 'crop-preload.cjs' },
        { source: 'movie-picker.cjs', output: 'movie-picker-preload.cjs' },
      ];

      for (const file of files) {
        const src = path.resolve(__dirname, 'electron/preload', file.source);
        const dest = path.join(destDir, file.output);
        const nextContent = file.content ?? fs.readFileSync(src, 'utf-8');

        try {
          if (fs.readFileSync(dest, 'utf-8') === nextContent) continue;
        } catch {
          // The output file is created below.
        }

        fs.writeFileSync(dest, nextContent, 'utf-8');
      }
    },
  };
}

function copySplashPlugin(): Plugin {
  return {
    name: 'copy-splash',
    writeBundle() {
      const src = path.resolve(__dirname, 'splash.html');
      const dest = path.resolve(__dirname, 'dist', 'splash.html');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    open: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          echarts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },
  plugins: [
    react(),
    copyPreloadPlugin(),
    copySplashPlugin(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['sharp'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
});
