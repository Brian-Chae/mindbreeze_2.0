# SDD-076 구현 결과

## 구현

플랫폼 관리자 전용 `PATCH/DELETE /admin/orgs/{org_id}/counselors/{user_id}`와 기관 상세 모달 상담사 행의 역할 변경·소속 해제를 구현했다. 기존 기관 관리자 `/org/.../counselors` API는 수정하지 않았다.

- PATCH: counselor↔org_admin, 필수 사유(공백 제거, 1–2000자), 잘못된 요청/대상 역할 422, 타 기관 대상 404.
- DELETE: org_id=None, org_admin이면 counselor로 변경, 204 반환. 사용자 계정·프로필·기존 연결·과거 세션과 기관 귀속 스냅샷을 보존한다.
- 주 담당자 강등/해제, 마지막 활성 org_admin 강등/해제, 개인 기관 소유자 역할 변경/해제를 409로 차단한다. 가입 대기/정지 관리자는 남은 활성 관리자 수에 포함하지 않는다.
- ready/scheduled/in_progress/paused 세션 또는 active 내담자 연결이 있으면 해제를 차단한다.
- 기관 행 잠금 → 대상 사용자 최신 조회/행 잠금 → 보호·업무 검증 → 사용자 변경과 VerificationAudit를 같은 트랜잭션에서 커밋한다. 감사 기록에는 행위자/대상/기관/행위/전후 role·org_id/사유/서버 시각이 남고 기관 version도 증가한다.
- 인증은 기존 `get_current_user`가 요청마다 DB 역할·소속을 조회하므로 별도 권한 캐시는 없다. 기존 토큰으로 기관 관리자 API를 호출해 변경된 권한이 적용됨을 테스트했다.
- 기관 잠금 대기 중 소속이 해제된 경우 세션 생성 및 내담자 연결이 이전 소속으로 진행되지 않도록 최신 소속 재검사를 추가했다.
- UI: 주 담당자/소유자 배지 및 보호 사유, 마지막 활성 관리자 비활성화, 확인·필수 사유, 실패 입력 유지, 중복 실행/처리 중 닫기 차단, 성공 후 상담사·상세·기관 목록 갱신.

## 승인 및 검증

`plan.md`와 `verify.md`를 구현 전에 작성하고 Orca ask를 통해 코디네이터의 명시적 승인을 받은 후 구현했다.

- RED: 신규 BE 29개는 미구현 경로 404로 실패, 잠금 대기 소속 변경 테스트 2개는 차단 누락으로 실패 확인 후 구현.
- RED: FE API 함수 누락 및 행 액션 누락을 테스트로 확인 후 구현.
- `cd backend && venv/bin/pytest tests/test_sdd074_admin_org_detail.py tests/test_sdd075_org_management.py tests/test_sdd076_org_counselor_management.py -q`: **71 passed**.
- `cd backend && venv/bin/pytest`: **587 passed, 12 skipped, 16 warnings**, 36.76초, exit 0. 기존 deprecation 경고 포함.
- `cd frontend && npm run build`: **exit 0**, 타입/빌드 오류 없음. 기존 대형 청크 및 design-system CSS tokens import 해석 경고 있음; 빌드 exit 0.
- `NODE_PATH=/tmp/f22-browser/node_modules node --test tests/org-management-api.test.cjs tests/org-counselor-management-browser.test.cjs tests/org-management-browser.test.cjs`: **5 passed** (API 2 + Chrome 브라우저 3).
- 브라우저: 390px 모바일 폭에서 보호 버튼, 필수 사유, 처리 중 닫기 차단, 409 입력 보존, 역할 변경, 소속 해제/목록 갱신 및 기존 기관 수정·비활성화·재활성화·포커스 복귀 확인. 서버 응답은 테스트 라우트 mock이며 실제 API는 BE 테스트로 별도 검증했다.
- `git diff --check`: 통과.

## 디버깅 및 검증 경계

브라우저의 처리 중 상태 검사는 150ms 고정 지연으로 실행하면 응답 완료 후 검사하는 타이밍 문제가 있었다. 첫 요청을 테스트가 명시적으로 해제하는 방식으로 변경해 처리 중 닫기 차단을 결정적으로 검증했다.

SQLite 테스트는 PostgreSQL FOR UPDATE 직렬화를 실행 검증하지 않는다. 신규 관리자 변경끼리는 기관 행 잠금을 공유하며 잠금 대기 후 소속 재조회 경계 테스트도 통과했지만, 실제 PostgreSQL 병렬 트랜잭션 부하 검증은 수행하지 않았다. 기존 기관 관리자 API 및 계정 정지 API의 정책까지 확장하지 않았으므로 본 보호 보장은 신규 플랫폼 관리자 경로 범위이다.

커밋·배포·운영 DB 적용·Linear 게시를 수행하지 않았다. 기존 `specs/.sdd-counter` 및 `spec.md` 작업은 보존했다. 독립 코드 리뷰와 Brian 최종 리뷰는 코디네이터의 후속 단계로 남는다.
