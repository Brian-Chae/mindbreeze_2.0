# SDD-019 에이전트 리뷰 종합

## 실행한 에이전트
- Claude: 백엔드/보안 리뷰 성공 (stdout 요약 회수)
- Codex: API/구현 리뷰 문서 생성 완료
- Cursor: UX/프론트 리뷰 문서 생성 완료
- Gemini: 실패 (UNSUPPORTED_CLIENT + trusted directory) — 지난 SDD-018과 동일

## 공통 합의 (3개 에이전트)
1. `config.py`의 `debug: bool = True` 단독으로 dev/prod를 판별하면 안 된다. 명시적 환경 식별자 신설이 필수.
2. dev 시뮬레이션은 기존 `login/register/Google` 흐름을 수정하지 말고 별도 라우터/컴포넌트로 격리.
3. prod에서는 dev 엔드포인트가 라우터에 물리적으로 포함되지 않아야 한다 (내부 guard만으로는 부족).
4. "비밀번호 없는 로그인" 토큰은 기존 `LoginResponse`/`authStore.applyLogin()` 경로를 재사용해 세션 정합을 유지.
5. 프론트 gating은 `import.meta.env` 플래그로 dev에서만 패널 노출.
6. org_admin/counselor 시뮬레이션은 org_id 필요 → 기본 demo org 자동 생성/연결.
7. 시뮬레이션 계정은 별도 식별(`@dev.local` 도메인 / `auth_provider="dev"` / SIM 배지)로 실계정과 분리.
8. 리스트는 전체 유저가 아니라 시뮬레이션 유저만 노출 (실계정 클릭 사고 방지).

## 에이전트별 차별 포인트
- Claude: "prod에 물리적으로 코드가 없어야 한다"를 최우선. 6겹 방어 + jwt 키 분리 + sim 클레임 거부. platform_admin 탈취 등 10개 리스크.
- Codex: 구체적 엔드포인트 4종 + 스키마 + 토큰 발급 helper 공용화 + role-org_id 검증 표. `_to_user_response` private 결합, `issue_refresh_token` 내부 commit 등 구현 함정 지적.
- Cursor: 다크 AI 톤 패널, 4역할 퀵 시드, "로그인 후 역할 스위처"(2차) 권고, gating 삼중(VITE + 서버 opt-in + status 프리플라이트), 접근성/동시로딩 리스크.

## 최종 설계 방향
- 환경 축: `environment`(기본 prod) + `sim_login_enabled`(기본 false) + 프론트 VITE 플래그 삼중 게이트
- 백엔드 축: 별도 `dev_auth` 라우터 조건부 include, 4개 엔드포인트(목록/생성/무비번로그인/정리), 토큰 발급 재사용
- 프론트 축: `DevRoleSimulationPanel`(로그인 하단), 추가+리스트+퀵시드, resolvePostLoginPath 공유
- 보안 축: prod 물리 미포함 + 시뮬레이션 계정 네임스페이스 격리

## 명시 결정 (미해결이 아니라 확정)
1. 환경 식별자: `environment` 필드 신설, 기본값 `"prod"` (fail-safe)
2. 시뮬레이션 플래그: 백엔드 `enable_dev_role_simulation`(기본 false) + 프론트 `VITE_ENABLE_ROLE_SIM`
3. 엔드포인트: `GET/POST /dev/auth/users`, `POST /dev/auth/login` (MVP), 정리는 선택
4. 시뮬레이션 계정 식별: `auth_provider="dev"` + 이메일 도메인 `@dev.local` 권장
5. 역할-기관: platform_admin은 org_id null, org_admin/counselor는 demo org 자동 연결
6. "로그인 후 역할 스위처"는 2차 개선으로 분리 (MVP는 로그인 패널만)

## Gemini 실패 기록
- 로그: /tmp/mb-019-gemini-run.log
- 원인: 인증 티어 지원 종료(UNSUPPORTED_CLIENT) + trusted directory 미설정
- 결론: 3개 에이전트로 확정, Gemini는 운영 블로커로 기록
