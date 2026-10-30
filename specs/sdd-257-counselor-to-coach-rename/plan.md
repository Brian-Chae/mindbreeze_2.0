# SDD-257 — 구현 계획

## 원칙
- 표기만 변경. 식별자·DB 값·라우트·API 필드는 불변.
- 자동 일괄 치환 금지(주석·식별자 오염 방지). 파일별 스크립트 치환 후 diff 사람이 검수, 문자열 리터럴·JSX 텍스트만 대상.
- SDD-256 머지 후 재스캔(`git grep 상담사`)으로 신규 문구 포함.

## 단계
| # | 단계 | 내용 | 산출 |
|---|---|---|---|
| 0 | 결정 확정 | spec §4 5건 답변 | spec 갱신 |
| 1 | 문구 상수화 | `frontend/src/lib/terms.ts` 확장: `counselor` 라벨 키(코치, 코치님, 코치용). 하드코딩 상위 파일부터 상수 사용 | terms.ts + 단위 테스트 |
| 2 | FE 일괄 | A 분류 약 106~140파일 문구 치환 | FE 빌드 통과 |
| 3 | BE 사용자 문구 | B 41파일: API detail·알림·이메일(`tasks/email.py` 33)·리포트(`report_*`·`class_report_narrative`)·AI 프롬프트(`agent_*`) | BE 테스트 |
| 4 | 네이티브 | 변경 대상 문자열 없음(주석만). 앱 이름·권한 설명 재확인만 | 확인서 |
| 5 | 테스트 기대값 | E 261파일(BE 129·FE 116·e2e 18) 기대 문자열 갱신 — 단계 2·3과 같은 담당 워커가 동행 | 전체 green |
| 6 | 법적 문서 | `ConsentModal`, 방침·약관 문구, 동의 버전(결정 3) | 버전 정책 |

## 병렬 분할 (경로 겹침 0, 워커 6)
| 워커 | 담당 경로 | 비고 |
|---|---|---|
| W1 | `frontend/src/lib/**`, `hooks/**`, `stores/**`, `types/**` | 단계1 먼저 단독 선행(상수 계약) |
| W2 | `frontend/src/pages/**` + 대응 `frontend/tests` | |
| W3 | `frontend/src/components/**` + 대응 tests, `frontend/e2e/**` | |
| W4 | `backend/app/api/**`, `schemas/**`, `ws/**` + 대응 `backend/tests` | |
| W5 | `backend/app/services/**` + 대응 tests | |
| W6 | `backend/app/tasks/**`(이메일·리포트), `backend/scripts/**` seed 표시명 + 대응 tests | |
검증 워커(구현자와 분리, Gemini): 각 PR diff 단위 리뷰·잔존 grep. 모델: 구현 Claude sonnet-5-5, 검증 Gemini. 동일 provider 동시 3개 제한 → W1 선행 후 W2~W4, 이어 W5~W6 두 배치.
alembic 과거 마이그레이션·`backend/alembic`은 **수정 금지**.

## 조사 보정 규칙
- 상담사→코치는 받침 영향 없음: 조사 그대로 유지.
- "상담사님"→"코치님", "상담사용"→"코치용", "담당 상담사"→"담당 코치", "상담사 코드"→"코치 코드".
- 결정 1에서 "상담"을 바꾸는 경우만 받침 규칙(이/가, 은/는, 을/를, 과/와) 적용 — 사전 치환표 + 수동 검수.

## 회귀 검사 게이트
1. 빌드 후 번들: `grep -r "상담사" frontend/dist` → 0건(허용 목록: 법적 문서 중 결정으로 유지한 항목).
2. API 응답 순회: 역할별(회원·코치·기관관리자·관리자) 주요 엔드포인트 JSON에서 "상담사" 0건.
3. 이메일·푸시·PDF 템플릿 렌더 결과 grep 0건.
4. `git grep "상담사" -- frontend/src backend/app`에서 남는 것은 주석(D)뿐임을 허용 목록(`allowlist.txt`)으로 확인.
5. FE 타입체크·vitest, BE pytest, e2e 스모크 통과. 상수화 단위 테스트.

## 반영 순서
PR 1개(`sdd/257-…`→develop) → dev 배포(승인 후) → verify.md 순회 → 앱 재빌드(iOS/Android dev) → 운영은 별도 승인. 앱은 웹 번들 포함이라 재빌드 필요.

## 규모 예상
파일 약 150(FE 문구)+41(BE)+261(테스트) ≒ 450파일, 문자열 약 450 + 기대값 약 990. 워커 6 + 검증 1, 소요 구현 약 1.5일 + 검증 0.5일 (결정 확정 후).
