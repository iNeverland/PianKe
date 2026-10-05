import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';
import fs from 'fs';

const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version as string;

/**
 * 让 `npm run dev` 与"从哪个终端启动"无关。
 *
 * 背景：`ELECTRON_RUN_AS_NODE=1` 会让 electron.exe 以**纯 Node** 模式运行。此时
 * `require('electron')` 退化成一个路径字符串，`require('electron').app` 是 undefined，
 * 主进程第一句 `app.requestSingleInstanceLock()` 就直接抛：
 *
 *   TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')
 *     at ... (node:electron/js2c/node_init:2:16955)
 *
 * 这个变量会被子进程继承，所以只要启动 vite 的那个终端带着它（例如由 Electron 类宿主
 * 应用派生的终端），vite-plugin-electron 拉起的 Electron 就必然是 Node 模式 ——
 * 表现成"Electron 应用莫名其妙起不来"，而报错完全指不到真正的原因。
 *
 * 清理时机：这里在**配置加载阶段**（Vite 主进程内、任何 devServer/子进程之前）就删掉它。
 * 不能放在 closeBundle：dev 模式下顶层 closeBundle 要等 server 关闭才触发，
 * 而 vite-plugin-electron 是在 httpServer 的 listening 回调里就 spawn 了 Electron。
 *
 * 对生产打包也无害：`vite build` 不启动 Electron，这个变量在那里没有作用。
 */
if (process.env.ELECTRON_RUN_AS_NODE !== undefined) {
  console.log('[pianke] 已忽略继承来的 ELECTRON_RUN_AS_NODE，避免 Electron 以纯 Node 模式启动');
  delete process.env.ELECTRON_RUN_AS_NODE;
}

function getSyncedPreloadContent(): string {
  const typesPath = path.resolve(__dirname, 'shared/types/index.ts');
  const preloadPath = path.resolve(__dirname, 'electron/preload/main.cjs');
  const typesContent = fs.readFileSync(typesPath, 'utf-8');
  const preloadContent = fs.readFileSync(preloadPath, 'utf-8');
  const match = typesContent.match(/export const IPC_CHANNELS\s*=\s*(\{[\s\S]*?\})\s*as\s*const;/);
  if (!match) {
    // 这里曾经是 `return preloadContent`：一旦 shared/types 里这个常量的写法变了，
    // 构建出的 preload 会安静地保留一份与真源脱节的旧通道表，没有任何提示。
    // 现在改为让构建直接失败。
    throw new Error('[preload] 无法从 shared/types/index.ts 解析 IPC_CHANNELS，请检查该常量的声明写法');
  }

  const channelsBlock = `// This block is generated from shared/types/index.ts during build.\n// Edit IPC_CHANNELS in shared/types/index.ts, not this generated copy.\nconst IPC_CHANNELS = ${match[1]};`;

  const nextContent = preloadContent.replace(
    /const IPC_CHANNELS\s*=\s*\{[\s\S]*?\n\};/,
    channelsBlock
  );
  if (nextContent === preloadContent) {
    throw new Error('[preload] 未能在 electron/preload/main.cjs 中定位 IPC_CHANNELS 代码块');
  }
  return nextContent;
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
              output: {
                // ⚠️ 主进程必须产出 CommonJS，且刻意用 .cjs 扩展名。
                //
                // 为什么不能用 ESM：package.json 声明了 `"type": "module"`，
                // 于是 vite-plugin-electron 会把主进程打成 ES 模块（产物里是
                // `import { app } from "electron"`）。但 Electron 34.5.8 内嵌的是
                // Node 20.19.1，它解析 ESM→CJS 互操作的那条路径有缺陷，加载入口时直接崩：
                //
                //   TypeError: Cannot read properties of undefined (reading 'exports')
                //     at cjsPreparseModuleExports (node:internal/modules/esm/translators:326:81)
                //     at createCJSModuleWrap (node:internal/modules/esm/translators:227:35)
                //
                // 这个报错完全发生在应用代码执行之前（模块实例化阶段），所以跟业务代码无关；
                // 外部 node --version 看到的版本不代表 Electron 内嵌的版本，排查时以
                // Electron 里 `process.versions.node` 为准。
                //
                // .cjs 而不是 .js：`"type": "module"` 依然生效，只有扩展名能无歧义地
                // 声明"这是 CJS"，不必去动 package.json 的 type（那会影响其它工具链）。
                // 入口改名后，package.json 的 main 字段也必须同步。
                format: 'cjs',
                entryFileNames: 'main.cjs',
                chunkFileNames: 'chunks/[name]-[hash].cjs',
              },
            },
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
              fileName: () => 'main.cjs',
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
