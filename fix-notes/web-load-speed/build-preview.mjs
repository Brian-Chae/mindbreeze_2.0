// 실행: node fix-notes/web-load-speed/build-preview.mjs /tmp/mb-speed-build 4180
import { build, preview } from '../../frontend/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../frontend', import.meta.url));
const outDir = process.argv[2];
if (!outDir?.startsWith('/tmp/')) throw new Error('출력은 별도의 /tmp/ 경로를 지정하세요.');
process.chdir(root);
process.env.VITE_API_BASE_URL = 'https://dev-api.mindbreeze.looxidlabs.com/api/v1';
process.env.VITE_SOCKET_URL = 'https://dev-api.mindbreeze.looxidlabs.com';
const config = { root, configFile: root + '/vite.config.ts', envFile: false, mode: 'speed', build: { outDir, emptyOutDir: false, sourcemap: true } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: Number(process.argv[3] || 4180), strictPort: true } });
server.printUrls();
