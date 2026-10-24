// 합성 API를 가로채는 캡처용 로컬 Vite. 환경파일과 원격 프록시를 사용하지 않는다.
import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
process.env.VITE_API_BASE_URL = 'http://127.0.0.1:5182/api/v1';
process.env.VITE_SOCKET_URL = 'http://127.0.0.1:5182';
const server = await createServer({
  root: frontend,
  envDir: false,
  envFile: false,
  mode: 'sdd242',
  server: { host: '127.0.0.1', port: 5182, strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:9' },
    '/socket.io': { target: 'http://127.0.0.1:9' },
  } },
});
await server.listen();
console.log('캡처 전용 로컬 Vite: http://127.0.0.1:5182');
