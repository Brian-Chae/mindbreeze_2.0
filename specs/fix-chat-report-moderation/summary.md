# [MB261026][FIX] 채팅 신고 운영 처리·게시 필터(D4) — Summary

- 브랜치 `fix/chat-report-moderation` (기준 origin/develop `f13cc705`, 커밋 전 `6d89088e`로 rebase) · PR #121
- 근거: D4(2026-10-24) "운영 전용 신고 수신 주소 + 플랫폼 관리자 페이지 신고 목록, 접수 2영업일·1차 판단 5영업일" + Apple 1.2(필터·신고 대응·차단·연락처)
- 설계·합격 기준: 같은 폴더 `plan.md`, `verify.md`(구현 전 작성, 시나리오 변경 없음)

## 1. 결과 요약

| 항목 | 구현 전 | 구현 후 |
|---|---|---|
| 신고 알림 수신자 | 가입 알림 키 공유, 개인 주소 기본값 | `MODERATION_NOTICE_EMAIL`(선택 SSM 키, 코드 기본값 빈 값). 비면 메일 outbox 없이 경고 로그(신고 ID만) |
| 알림 본문 | ID 나열 + "chat_reports 테이블에서 확인" | 신고 ID·사유·두 기한 + 관리자 화면 링크. 대화 내용·이름·이메일 없음 |
| 관리자 신고 처리 | 없음 | `/admin/chat-reports` 목록·상세·상태 전이 API·화면, 영업일 기한·기한 초과 표시, 열람·전이 감사 |
| 게시 필터 | 없음 | 운영자 금칙어 기반 전송 차단(422). 관리 화면에서 추가·삭제(즉시 반영) |
| 채팅 화면 연락처 | 개인 주소 노출 | 승인된 운영 이메일(`OPERATIONS_EMAIL`) |
| 공개 문구 | 기한 안내 없음 | 약관·신고 완료 화면에 "영업일 기준 2일 / 5일" + 필터 안내 |

## 2. 변경 파일

| 영역 | 파일 |
|---|---|
| 설정 | `backend/app/config.py`(키 2개), `deploy/env-manifest.tsv`(선택 행 2개) |
| DB | `backend/app/models/chat.py`(ChatReport 4컬럼·인덱스, ChatFilterTerm), `models/__init__.py`, 마이그레이션 `e261026c0001`(단일, down `e246a0301001`) |
| 서비스 | 신규 `business_days.py`·`chat_content_filter.py`·`chat_report_admin_service.py` / 수정 `chat_moderation_service.py`(수신자·본문·철회 잠금), `chat_service.py`(필터 1곳) |
| API | 신규 `api/v1/admin_chat_reports.py`·`schemas/chat_report_admin.py`, `api/v1/__init__.py`(등록 1줄) |
| 분류 계약 | `dev_data_reset.py`(chat_filter_terms 보존 분류), `account_deletion_sweep_service.py`(handled_by·created_by NULL 처리) |
| 시드(B1) | `backend/scripts/seed_chat_filter_terms.py`, `backend/scripts/data/chat_filter_terms_default.txt` |
| 프론트 | 신규 `pages/admin/ChatReportsPage.tsx` / 수정 `App.tsx`, `SidebarNav.tsx`, `lib/api/admin.ts`, `lib/api/chat.ts`, `lib/api/client.ts`(오류 코드 문구 8개), `ChatRoom.tsx`, `report-dialog.tsx`, `blocked-users-list.tsx`, `terms-page.tsx` |
| 테스트 | 신규 `test_business_days.py`, `test_chat_content_filter.py`, `test_chat_report_admin.py`, `test_chat_filter_seed.py`, `tests/pg/test_fix_chat_report_moderation.py`, `frontend/tests/fix-chat-report-moderation.test.tsx`, `frontend/e2e/chat-report-moderation{.mjs,-fixture.py}` / 기대값 갱신 4곳(아래 4절) |

SDD-246 소유 경로·`api/v1/admin.py`·`backend/app/ws` 변경 0(V-60, `git diff --name-only f13cc705 -- …` 0줄).

## 3. 테스트 (RED → GREEN)

| 구분 | 수정 전 | 수정 후 |
|---|---|---|
| 백엔드 신규 4파일(`business_days`·`content_filter`·`report_admin`·기존 `sdd220_chat_moderation`) | 40 error(모듈·설정 키 없음) | 56 passed (9+9+21+17) |
| 시드·기본안 `test_chat_filter_seed.py` | (데이터 파일과 함께 작성) | 21 passed |
| PG 전용(V-19 동시성·V-58 왕복·스키마) | – | 3 passed, PG 스위트 전체 495 passed(새 로컬 DB 1회) |
| 프론트 `fix-chat-report-moderation.test.tsx` | 파일 실패(화면 모듈 없음) → 오류 문구 8건 추가 RED 8 fail | 21 passed |
| E2E 실렌더(설치 Chrome, 로컬 서버) | – | 6/6 PASS (`evidence/e2e-results.json`, 캡처 6장) |

### 전체 회귀

| 스위트 | 기준선(`f13cc705` 스냅샷) | 이 브랜치 |
|---|---|---|
| pytest 전체(SQLite) | 4563 passed · 508 skipped · 0 failed | (아래 6절에 최종 기록) |
| vitest 전체 | 17 failed / 8 files · 3275 passed | 17 failed / 8 files(같은 파일 집합) · 3296 passed |
| tsc -b / 변경 파일 eslint / build | – | 0 오류 / 0 / 성공 |
| alembic 헤드 | 1 | 1 (`e261026c0001`) |

## 4. 계획 대비 달라진 점과 이유

1. **전이 응답에서 발췌·이메일 제거**: plan은 전이 응답을 상세와 같게 두었으나, 그러면 "보기"를 누르지 않아도 발췌가 전송된다. 열람은 상세 조회(감사 1행)로만 일어나게 했다(V-07에 단언 추가).
2. **오류 코드 문구 등록(`client.ts`)**: E2E에서 금칙어 차단 안내가 "API 요청 실패 (422)"로 보이는 문제를 발견. 공용 포맷터가 `{code,message}`는 등록된 코드만 문구로 바꾸기 때문. 이번에 만든 코드 8개만 등록(다른 화면 동작 불변), RED 8 → GREEN.
3. **분류 계약 2곳 추가**: 기존 계약 테스트가 새 FK·새 테이블 분류를 요구했다. 금칙어는 운영 설정이라 dev 초기화에서 보존, 관리자 탈퇴 시 처리자·등록자 참조만 NULL(신고 행은 기존대로 당사자 탈퇴 시 삭제).
4. **사이드바 라벨**: `lib/terms.ts` 키 대신 기존 데이터 센터 항목처럼 `label: '채팅 신고'`(용어 사전 골든 22키 유지).
5. **알림 본문**: 신고자·대상·방·메시지 ID도 뺐다(신고 ID로 관리자 화면에서 확인).
6. **기존 테스트 기대값 갱신(의도된 변경)**: `test_sdd220_chat_moderation`(수신 키), `tests/pg/test_pg_migration_schema`(테이블 116→117), `nav-labels-characterization`(관리자 메뉴 1개), `sdd220-chat-moderation`(mailto 개인 주소 → 운영 이메일).

## 5. Brian 확인 필요

### B1 — 기본 금칙어 안(31개, 아직 어디에도 등록 안 함)
파일: `backend/scripts/data/chat_filter_terms_default.txt`. 승인 후 운영자가 `python scripts/seed_chat_filter_terms.py apply --confirm`(멱등·감사 기록) 또는 관리 화면에서 등록.

| 분류 | 단어 |
|---|---|
| 욕설 | 씨발, 씨팔, ㅅㅂ, ㅆㅂ, 병신, ㅂㅅ, 개새끼, 개새기, 개색기, 좆같, 좆까, 지랄, ㅈㄹ, 느금마, 니애미, 미친놈, 미친년, 썅년, fuck, bitch |
| 성적 표현·성매매 유도 | 섹스, 몸캠, 조건만남, 딸딸이, 창녀, 걸레년 |
| 혐오 표현 | 한남충, 김치녀, 틀딱, 짱깨, 쪽바리 |

- 정규화가 띄어쓰기를 지우므로 두 단어가 붙어 생기는 오탐 단어는 뺐다: 강간(한강 간다), 염병(폐렴 병원), 야동(야 동생), 존나(보존 나중에), 씨바(아저씨 바로), 맘충(맘 충분히), 시팔(회의시 팔로우), shit(push it), 보지·자지(보지 마세요·자지 마). 대표 오탐 문장 13개가 막히지 않는 것을 테스트로 고정.
- 남은 오탐 위험: `병신`("질병 신고"), `개새끼`("개 새끼(강아지)"). 빼려면 알려 주세요.

### B2 — 운영 전용 신고 수신 주소
- 코드는 `MODERATION_NOTICE_EMAIL` 키만 둔다. 값이 없으면 메일 없이 관리자 화면 + 경고 로그만(로컬 실서버 로그로 확인: "운영 신고 수신 주소(MODERATION_NOTICE_EMAIL) 미설정 — 메일 알림 생략").
- 주소를 정하면 OPS가 SSM에 등록하고, `email_app` worker와 본인 주소 테스트 1통은 별도 게이트(G-2).

## 6. 남은 일 · 후속

| 항목 | 담당 | 비고 |
|---|---|---|
| 지원 FAQ에 신고 처리 기한 1문항 | 후속 FIX(1파일) | PR #119가 develop에 들어왔다(`6d89088e`). 감독 지시대로 이번에는 넣지 않음. 문안: "채팅에서 불쾌한 메시지를 받았어요 → 메시지 ⋯ 메뉴에서 신고하면 즉시 서로 차단되고, 운영팀이 영업일 기준 2일 안에 접수를 확인하고 5일 안에 1차 판단합니다. 추가 내용은 운영 이메일로." |
| G-1 dev 반영 검증 | DEPLOY | V-53·V-54 재현(합성 계정) |
| G-2 운영 주소 등록·발송 확인 | OPS(B2 후) | 본인 주소로만 |
| G-3 초기 금칙어 등록 | 운영자(B1 후) | 시드 스크립트 또는 관리 화면 |
| G-4 실기기 | APP | 차단 안내·신고 완료 문구·연락처 |
| G-5 운영 반영 | DEPLOY(Brian 승인) | 마이그레이션 `e261026c0001` 포함 |
| 심사 메모 문안 | 스토어 준비 창구 | "채팅은 신고 즉시 상호 차단, 운영팀이 영업일 2일 내 접수 확인·5일 내 1차 판단, 운영 금칙어 필터로 부적절 표현 전송 차단, 연락처 admin-mindbreeze@looxidlabs.com" |

### 참고(이번 범위 밖, 발견만)
- 채팅 화면 오류 줄이 한 줄 말줄임이라 모바일에서 안내 뒷부분("내용을 고쳐…")이 잘린다(`member-blocked-mobile-390.png`). 핵심 문구는 보인다.
- 로컬 E2E에서 Socket.IO 핸드셰이크 403·웹푸시 공개키 503(VAPID 미설정)은 로컬 환경 잡음으로 따로 기록(`ignoredEnvNoise`). 이번 변경은 `backend/app/ws`를 건드리지 않는다.
- 로컬 검증에 쓴 임시 자원(로컬 PG DB `mb_chatmod_smoke`·`mb_chatmod_smoke2`·`mb_chatmod_e2e`, `/tmp/mb-chatmod-*`)은 지우지 않았다. 정리 여부는 감독 판단.
