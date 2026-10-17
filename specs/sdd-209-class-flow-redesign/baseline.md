# SDD-209 T0 — 기준선 (2026-10-17, develop `4b2e6809`)

> Stage ② Plan Task **T0** 산출. 구현 코드는 한 줄도 바꾸지 않았다. 구현 시작 후 회귀 판단 기준으로 쓴다.

## 1. worktree

| 항목 | 값 |
|---|---|
| 경로 | `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd209-wt` (저장소 밖, 원본 옆) |
| 브랜치 | `sdd/209-backend` (develop `4b2e6809` 에서 분기, 변경 없음) |
| 의존성 | 프론트 `node_modules` 는 원본 저장소 것을 **심볼릭 링크**(worktree 안 `frontend/node_modules`, git 무시 대상). 백엔드는 원본 `backend/venv` 파이썬 사용 |
| 정리 | `git worktree remove ../mindbreeze_2.0-sdd209-wt` (심볼릭 링크는 먼저 지우지 않아도 됨) |

## 2. 정적/단위 검증 기준선 (worktree 에서 실행)

| 검증 | 명령 | 결과 | 시간 |
|---|---|---|---|
| 프론트 타입 | `npx tsc -p tsconfig.app.json --noEmit` | **오류 0, exit 0** | 8.5s |
| 루트 tsc | `npx tsc --noEmit` (CI 와 동일) | exit 0 — **의미 없음**: 루트 `frontend/tsconfig.json` 은 `files: []` + `references` 뿐이라 아무것도 검사하지 않는다(plan §9.2 미확인 해소). 구현 중에는 항상 `-p tsconfig.app.json` 사용 | — |
| 프론트 린트 | `npx eslint src/` | **오류·경고 0, exit 0** | — |
| 프론트 단위 | `npx vitest run` | **11 실패 / 1109 통과 (1120), 파일 6 실패 / 85 통과 (91), exit 1** | 70.6s |
| 백엔드 | `python -m pytest -q --ignore=tests/test_sprint4_integration.py` | **1770 통과, 12 skip, 실패 0, exit 0** (CI 가 deselect 하는 PDF 1건도 이 환경에서 통과) | 153.6s |

### 2-1. 프론트 vitest 실패 11건 (구현 전부터 존재 — 회귀 아님)

| 파일 | 건수 | 원인(출력 근거) |
|---|---|---|
| `tests/report-modal-pdf.test.cjs` | 2 | `fetch failed … ECONNREFUSED 127.0.0.1:5175` — 별도 dev 서버(5175)가 떠 있어야 하는 브라우저형 테스트 |
| `tests/report-server-pdf.test.cjs` | 2 | 동일(5175 접속 불가) |
| `tests/org-management-browser.test.cjs` | 2 | Playwright `locator.click` 타임아웃(대상 서버 부재로 추정, 같은 계열) |
| `tests/org-counselor-management-browser.test.cjs` | 1 | 동일 계열 타임아웃 |
| `tests/agent-counselor-page.test.tsx` | 2 | `AssertionError: expected undefined to be 1000`, `'set value' called on an object that is not a valid instance of HTMLInputElement` — 렌더 환경(jsdom) 문제로 보임, 코드 원인 `미확인` |
| `tests/chat-message-deeplink.test.ts` | 2 | `expected undefined to be true` (대상 failure/missing 시 복귀 동작) — 원인 `미확인` |

- CI(`ci-feature.yml`)는 `npm test` 를 **비차단**으로 두므로 현재 CI 상태와 일치. 신규 Task 의 테스트는 위 11건과 무관하게 전부 통과해야 한다.
- 완료 판정 기준: 구현 후 실패 목록이 **위 11건 이하(동일 항목)** 일 것.

## 3. 타인 미커밋 변경

원본 저장소(`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, develop) `git status` — 세션 시작 시점은 clean 이었고, 조사 중 **다른 에이전트가 `designs/class-flow-redesign/` 를 수정 중**(약 28개 파일 M: `fit/*` 측정 산출물, `flow-base.css`, `host-b.html`, `member-a.html`, `member-b.html`, `tools/host-a-capture.mjs` 등). 이 작업은 해당 디렉터리를 건드리지 않았다. 그 외 경로(`frontend/`·`backend/`·`specs/` 의 타인 변경)는 **없음**. 스테이지에 올릴 때 `specs/sdd-209-class-flow-redesign/` 만 개별 지정한다.
- 연관 worktree: `mindbreeze_2.0-sdd208*`(SDD-208 3개), `.claude/worktrees/*`, paseo `e2e-decisions`, orca `develop` 이 별도로 존재 — SH7 `SidebarNav.tsx` 등 충돌 지점은 구현 시점에 다시 확인.

## 4. 원본 보유 스냅샷 (dev, 읽기 전용 집계)

- **준비물**: `baseline-snapshot.sql`(SELECT 11개) + `baseline-snapshot.py`(READ ONLY 트랜잭션, SELECT 외 거부, 접속 정보는 환경변수로만 받고 출력하지 않음).
- **실행**: dev EC2(`ubuntu@18.183.86.88`)에 두 파일을 임시 복사 → 서버 `.env.dev` 의 DB 주소를 환경변수로 읽어 실행 → 임시 파일 삭제. 출력은 개수·바이트·날짜 구간뿐이며 개인정보·토큰·비밀번호·코드 값은 조회하지 않았다. 측정 시각 = 2026-10-17 KST 오후.
- 배포 전/후 동일 쿼리를 다시 돌려 이 표와 비교한다(RV1·RV7).

### 4-1. DB 집계 (Q1~Q11)

| 구분 | 값 |
|---|---|
| 클래스(템플릿 제외) | completed 91 · cancelled 6 · in_progress 1 · ready 2 · scheduled 2 (총 102), 첫 생성 2026-06-10 / 마지막 2026-10-16, 코드 보유 79 |
| 참여자 | 회원 71(대기 0) · 비회원 26(대기 0). 비회원 이름 26, 성별 8, 생년월일 8, 리포트 이메일 8. 회원 중 `report_email` 17. `consent_eeg=true` 회원 53/비회원 7, `consent_audio=true` 0 |
| 리포트 메일 상태 | sent 17, 미설정 8 |
| 음성 청크(Q3) | 1,405행 / **110,149,590 B**, 90일 경과 0, 최초 2026-09-18 ~ 최신 10-12, 경로 전부 로컬 절대경로 |
| 영상 청크(Q4) | 2,277행 / **1,801,852,771 B**, 90일 경과 0, 최초 09-18 ~ 10-06, 로컬 경로 982행 |
| EEG raw 청크(Q5) | uploaded 1,550행 / **3,080,000 B**, 90일 경과 0 (2026-10-04 단일 일자) |
| 세션 기록(Q6) | 60건. 병합 영상 키 보유 **38**, 병합 음성 키 **0**(미사용), 전사문 보유 47 / 총 87,574자, 요약 JSON 131,747 B, 수동(마이크 오프) 6 |
| EEG 지표(Q7) | 윈도우 **46,106행**(참가자 49명), `eeg_records` 9건(파일 수 합 1,550) |
| 리포트(Q8) | client completed 63 · pending_review 1 / counselor completed 60 · pending_review 1. 내용 JSON 합 약 1.9 MB |
| 서사 캐시(Q10) | llm 11건 (개인 데이터 없음) |
| 마이그레이션(Q11) | head `e036a0000041` 단일 |

### 4-2. 실제 파일/객체 (DB 와 별개로 확인 — **DB 행 수 ≠ 보유 바이트**)

| 저장소 | DB 기록 | 실제 확인 | 비고 |
|---|---|---|---|
| S3 `mindbreeze-dev` `eeg-raw/` | 1,550행 | **1,550 객체 / 3,080,000 B** | DB 와 일치 |
| S3 `video/` | 청크(S3 경로) 1,295행 + 병합 38 | **1,316 객체 / 2,183,957,108 B** | 청크 일부는 병합 후 정리 대상 |
| S3 `research-export/` | — | 0 | 아직 없음(신규) |
| 서버 `/tmp/mindbreeze_audio/` | **1,383행 / 107,763,835 B** | **1,050개 파일 / 81,817,929 B** | **333행(약 24%)의 파일이 이미 없음** — `/tmp` 정리로 소실 추정 |
| 서버 `/var/lib/mindbreeze/audio/` | 22행 / 2,385,755 B | 22개 / 2,385,755 B | 영속 경로, 일치 |
| 서버 `/tmp/mindbreeze_video/` | **982행 / 778,364,338 B** | **0개** | 영상 로컬 폴백 청크 전부 소실(병합본 없는 채 행만 남음) |
| 서버 루트 디스크 | — | 19G 중 9.5G 사용(52%) | 여유 8.9G |

- 음성은 병합본 없이 **청크 파일만** 보존되고(`audio_s3_key` 미사용), 위 `/tmp` 경로는 재부팅·정리로 사라지는 위치다. 이는 SDD-209 이전부터 있던 데이터 보존 결함이며, 스위프 dry-run/삭제 후보 건수는 **"행 기준"과 "실파일 기준"을 따로** 보고해야 한다.
- 가장 오래된 청크가 09-18 인데 클래스는 06-10 부터 있다. 현행 90일 스위프가 2026-10-06 부터 매일 돌고 있어(조사 11 §S1) 7월 중순 이전 청크가 이미 삭제됐을 가능성이 있으나 로그(`/var/log/mindbreeze-media-sweep.log` 0바이트)로 확인되지 않는다 → `미확인`.

### 4-3. 서버 상태 (참고)

- `mindbreeze-backend`·`mindbreeze-worker`·`mindbreeze-email-worker` systemd 모두 active. 서버 시간대 UTC.
- crontab: `30 4 * * *` EEG raw 스위프, `45 4 * * *` 미디어 스위프(둘 다 활성).
- S3 버킷 lifecycle 규칙 없음, 버저닝 비활성(조사 11 §6).

## 5. 이번 T0 에서 하지 않은 것

| 항목 | 사유 |
|---|---|
| 시안 케이스 문구 정규식 기준선(금지 용어 0건 확인) | plan §10 에 "R0 이후 T0 기준선" 으로 명시. 시안(`designs/class-flow-redesign/`)이 다른 에이전트에 의해 **수정 중**이라 지금 측정하면 바로 무효가 된다. R0 완료 후 재측정 필요 |
| Playwright E2E(`e2e/*`, `e2e-smoke`) | 배포된 dev 대상 스크립트이며 구현 전 변경 대상이 아니라 제외 |
| 프론트 `npm run build` | 이번 단계 코드 변경이 없어 tsc/eslint 로 대체(CI 에서는 차단 항목 — 구현 완료 시 실행) |
| vitest 브라우저 설정(`vitest.browser.config.ts`, `test:browser`) | 별도 서버 필요 — 기준선에 포함하지 않음 |
