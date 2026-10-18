# 워커 브리프 — SDD-211 (클래스·세션 재설계 Phase 0 선행 정리) spec·plan·verify 작성

SDD ①Spec ②Plan ③Verify 만 쓴다. **코드 수정·DB 조회 실행·git 커밋·푸시 금지.** 쓰기 허용: `specs/sdd-211-class-structure-phase0/` 아래 `spec.md`, `plan.md`, `verify.md`, `investigation/*.md` 만. 경로에 공백 → 따옴표. ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`.

## 먼저 읽을 것
1. `docs/class-session-restructure/기획.md` — §0 Phase 개요, **§9 Phase 0**, §12 위험, §13 검증, §14 미확인, `영향도.md`, `결정-필요.md`(하단 "확정 기록": D-60 무중단·SDD-210 선후는 미확인, D-62 호칭).
2. `docs/class-session-restructure/조사/R2-API서비스.md`, `R7-이전계획.md`, `R8-용어IA.md`, `R9-강사모델권한.md`, `R6-리포트분석.md`(R6-X1), `R10-상담분리.md` (Phase 0 근거).
3. SDD 선례(같은 형식·깊이): `specs/sdd-209-class-flow-redesign/{spec,plan,verify}.md`, `specs/sdd-208-class-player-redesign/`. 인프라 SDD: `specs/sdd-210-prod-environment/` (prod 컷오버와의 관계 확인).
4. CI: `.github/workflows/{ci-feature,deploy-dev,e2e-smoke}.yml`, 배포 롤백 트랩(DB 되돌림 없음).

## Phase 0 범위 (기획 §9 Phase 0, 변경 없음 — 기능 추가 아님, 동작·문구 변경 최소)
1. 영역별 용어 사전(`lib/terms.ts` + 서버 `services/session_terms.py` 골격), 탭·사이드바 배지를 **키 기반**으로(현행 `label === '클래스'` 비교 3곳), 용어 가드 분리(`BANNED_COPY`·`class-flow-shell-terms.test.ts` 영역별). 문구·동작 변경 없음.
2. 호스트 판정 단일화 `authorize_session(user, session, action)` — 5개 서비스 파일의 복제 헬퍼 9곳을 동작 동일 리팩터.
3. 세션 생성·수정 API 에 역할 가드(`require_roles("counselor","org_admin")`) — 현재 로그인만 확인하는 틈. **기존 클라이언트/앱이 깨지지 않는지(client 토큰으로 세션을 만드는 정상 경로가 있는지) 반드시 조사**.
4. PostgreSQL 대상 `alembic upgrade head` CI 스모크(빈 DB + 스냅샷 복원본). 현재 CI 에 PG·alembic 단계 없음.
5. 구 계약 회귀 스냅샷 테스트(`/sessions/*` 응답 형태 고정).
6. **R6-X1 검증**: 회원에게 `pending_review` 리포트가 승인 전에 노출되는지 코드·테스트로 확인(실제 dev 호출은 plan 에 절차만 쓰고 실행하지 않음), 필요 시 수정 계획.
7. **M0 사전 조회 설계**: 분포 조회 SQL(R7 §3.2, R10 Q1~Q5) 실행 절차(집계 건수만, 개인정보 컬럼 조회 금지, 서버 SSM/스크립트 경유 — 실행은 구현 단계), 기준선 102건과 SDD-210 "134건" 차이 원인 조사 방법, 수동 RDS 스냅샷 절차 문서화.

## 산출 (SDD-209 와 같은 형식·깊이)
- `spec.md`: 목적, 범위, 비범위(Phase 1 이후), 확정 결정, 상태.
- `plan.md`: 코드 조사 근거(파일:줄), Task 분해(트랙·소유 파일·테스트·완료 기준·규모), 변경되는 현행 동작(체감 변화 거의 없음 — 역할 가드 영향 명시), 위험·롤백(코드 revert, DB 변경 없음), CI 변경(PG 서비스 컨테이너, 시간 영향), 배포 순서, D-60 prod 컷오버(SDD-210) 선후 확인 결과 또는 `미확인`, **사용자 결정 필요**(비즈니스만, 기본값 포함 — 기술은 plan 이 결정).
- `verify.md`: 구현 전 QA 게이트(시나리오·테스트 목록·합격 기준·측정, 구현 후 완화 금지 규칙), 회귀(SDD-208/209 케이스·E2E 스모크), 보안 시나리오(client 토큰 세션 생성 403, 승인 전 리포트 비노출).
- `investigation/` 조사 메모.
완료 보고 숫자로: 줄 수, Task 수, 사용자 결정 필요 개수, 확인하지 못한 것. 근거 없는 주장 금지, 확정 결정 뒤집지 마라.
