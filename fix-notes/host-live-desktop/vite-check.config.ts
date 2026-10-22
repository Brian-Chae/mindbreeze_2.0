// .env를 읽지 않고 기존 설정으로 빌드를 검증한다.
import base from '../../frontend/vite.config';
export default { ...base, envDir: '/tmp/mindbreeze-no-env' };
