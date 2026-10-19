# SDD-217 배포 전 lint 최소 수정 결과

## 원인 및 변경

- 기존 `release-lint.log`의 RED 오류 2건을 확인했다.
- `frontend/src/pages/client/guest-class-membership-page.tsx:25`: 일반 상태 변경 콜백 `useReadCredential`이 훅 이름 규칙으로 오인됐다. `switchToReadCredential`로 선언 및 사용처 총 3곳의 이름만 변경했다.
- `frontend/src/pages/sessions/ClassPlayerPage.tsx:639`: `handleQuietSignal` 본문에서 참조하지 않는 `isCurrentRoute`를 해당 useCallback 의존성에서만 제거했다. 다른 훅/권한/기능 로직은 변경하지 않았다.

## 검증

- 두 파일 `npx eslint`: 통과, 오류/경고 출력 없음.
- `npm test -- tests/sdd217-member-operations.test.tsx tests/sdd217-presence-socket.test.tsx tests/class-player-page-live.test.tsx`: 3 파일, 66 테스트 통과.
- `npm run build`: TypeScript 및 Vite 빌드 통과(exit 0).
- 빌드 경고: design-system tokens.css import 해석 실패, 동적/정적 import 중복, 500 kB 초과 청크. 이번 최소 수정 범위 밖이며 빌드는 완료됐다.
- 신규 테스트 및 전체 BE 회귀는 실행하지 않았다. 커밋/푸시하지 않았다.

## 범위

기존 변경이 많은 워크트리를 보존했다. 이 작업에서 제품 파일 수정은 지정된 두 파일뿐이다. 전체 lint 및 리뷰/커밋은 상위 에이전트가 담당한다.
