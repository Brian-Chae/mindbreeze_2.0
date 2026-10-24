import base from '../vite.config';
import { defineConfig } from 'vite';
// 로컬 fixture 검증은 .env를 읽거나 기존 개발 API 프록시를 사용하지 않는다.
export default defineConfig({ ...base, envDir: false, server: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: {} } });
