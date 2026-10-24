# 전체 vitest의 로컬 브라우저 검증 환경

기존 CJS 브라우저 테스트는 5175 Vite와 `node_modules/.vite/deps/_metadata.json`의 browserHash를 사용한다. Vite 8은 실행 중인 모듈의 hash와 디스크 metadata가 달라질 수 있고, 전체 vitest 중 디스크 값이 덮이는 현상을 확인했다. 이 경우 소스가 같아도 report-server-pdf 등에서 504/중복 React 로딩으로 실패한다.

제품 코드·기존 테스트 단언을 바꾸지 않고 검증하기 위해, `/tmp`의 Vite 구성에 아래 읽기 전용 middleware를 추가했다. metadata HTTP 응답만 실행 중인 개발 서버의 값으로 제공한다. 소스·.env·실서버를 변경하지 않는다.

```js
import config from '/절대/워크트리/frontend/vite.config.ts';
export default { ...config, plugins: [...config.plugins, {
  name: 'verification-live-deps-metadata',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/node_modules/.vite/deps/_metadata.json') return next();
      const metadata = server.environments.client.depsOptimizer?.metadata;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ browserHash: metadata?.browserHash }));
    });
  },
}] };
```

1. `frontend`에서 이 구성을 지정한 로컬 Vite를 5175로 실행한다.
2. `/src/main.tsx`를 한 번 요청하여 최적화를 완료하고, 같은 구성·캐시 그대로 본인 Vite만 재시작한다. Vite가 캐시를 다시 읽으면 모듈별 hash가 공통 hash로 복원된다.
3. metadata 응답의 hash와 main.tsx의 React/ReactDOM import hash가 일치하는지 확인한다.
4. `npm test` 전체를 실행한다. 실행 완료 뒤 본인 Vite만 종료한다.

최종 실행은 `/tmp/guest-minor-vite-current-metadata.mjs`를 사용했다. 캡처는 별도 실제 React 화면·합성 API 스크립트로 검증했다. 이 환경 보정은 제품 동작 수정이나 기존 실패 단언 제거가 아니다.
