# SDD-327 plan — 회원 개인 명상 리포트 v11 이식

## A. 현 구조 조사 결과

**PDF 생성**: `backend/app/services/report_pdf_service.py` — WeasyPrint 68.1(`requirements.txt`), HTML 문자열 → PDF, 번들 `NotoSansKR.ttf`만 허용하는 url_fetcher, content 해시 메모리 캐시, **4쪽 고정** 서사형. 엔드포인트 `GET /reports/{id}/pdf`(`api/v1/reports.py`)·메일 링크 `/reports/view/pdf`. 18쪽 책·명조 임베드·SVG 그래프는 기존 틀로 수용 가능(WeasyPrint는 SVG 인라인·@page 지원) → **헤드리스 Chrome 신규 도입 불필요**.
**리포트 생성**: `tasks/report_task.py`(`generate_report_inline`, client/counselor 리포트 `content` JSON 생성) + `_attach_class_report`가 `content.class_report` 부착, `tasks/class_report_task.py`가 Gemini 초안. 통계 정본 `class_report_stats_service.py`(6지표, 전·후반 분할은 `report_narrative` 공용).
**프런트**: 회원 리포트 목록 `pages/client/ClientReportListPage.tsx`(`/app/reports`, `ClientAppPage` 분기) + `ClientReportDetailModal.tsx`, 공용 `components/reports/ReportDetailView.tsx`, 인쇄 `lib/report/print-report.ts`. 회원 클래스 화면 `member-class-detail-page.tsx`·`member-class-trend.tsx`(회차별 리포트 링크). `/report-view`(`ReportViewPage`)는 메일 토큰 열람.
**반응형/앱**: `capacitor.config.ts` `appId com.looxidlabs.mindbreeze2`, `webDir: dist` → 앱은 웹 SPA 번들을 그대로 로드. 따라서 **모바일·데스크톱·앱은 같은 React 반응형 컴포넌트 1벌**로 만든다(분기점 700px, 데스크톱에서 좌측 목차 고정). 앱 전용 화면 없음 → 단, 앱 WebView에서 PDF 다운로드/공유 동작은 verify에서 별도 확인.

### 데이터 매핑표 (시안 값 → 원천)

| 시안 값 | 원천 | 상태 |
|---|---|---|
| 집중도·이완도·감정 균형도 매분 값 | `EEGFeatureWindow.focus_index/relaxation_index/emotional_stability` (+ 정규화 `eeg_metrics`) | **있음** (`class_report_stats`가 개인 평균·전후 계산) |
| 심박수·RMSSD·SDNN·LF/HF·몸 움직임·호흡 | `EEGFeatureWindow.heart_rate/rmssd/sdnn/lf_hf_ratio/motion/respiratory_rate`, 롤업 `summarize_hrv_motion` | **있음** |
| 구간별 중앙값·전후 변화량 | 윈도우 → 신규 집계(중앙값) | **신규 계산**(평균은 있음, 중앙값 없음) |
| 안정된 5분 RMSSD/SDNN/HR | 모션이 낮은 연속 5분 구간 선택 | **없음 → 신규 계산** |
| 그룹 분포(평균선·분포 막대) | 클래스 평균·범위는 있음, **개인별 분포 히스토그램은 없음** | **신규 계산**(집계만, 최소 N 가드) |
| 1/f 기울기 | `delta..gamma_power`만 있고 스펙트럼 기울기 저장 없음. 프런트 `lib/eeg/`에 Morlet+PSD | **없음 → 신규 계산**(위치 결정 아래) |
| LF/HF 흐름 | `lf_hf_ratio` 윈도우 | 있음 |
| 수업 여정(구간별 움직임·심박 맥락) | 롤업 버킷 + `motion` | 있음(표현 신규) |
| 종합 의견 | 규칙 문장 + Gemini 초안 경로(`class_report_task`) | 경로 있음, **회원용 문장 틀 신규** |

**결정 필요(기본값) — 계산 위치**: 신규 값(중앙값·안정된 5분·분포·1/f)은 **백엔드 서비스에서 리포트 생성 시 1회 계산해 `reports.content.member_report`(JSONB)에 저장**. 화면·PDF는 저장 JSON만 읽음(재계산 없음, 숫자 불일치 방지). 1/f는 원시 EEG가 필요 → `eeg_raw_service`/Parquet 원천 접근 가능 여부를 Task B3에서 먼저 확인, 불가·결측이면 14쪽 생략(§spec 6 규칙).
**마이그레이션**: `content`가 JSONB이므로 **Alembic 마이그레이션 불필요**(기본값). `content.member_report.schema_version`으로 버전 관리. (스펙 변경으로 컬럼이 필요해지면 담당 워커 1명만 생성.)

## B. 아키텍처

- **단일 데이터 계약**: `content.member_report` JSON(섹션·문장·수치·SVG 입력 좌표가 아닌 *데이터*). 계약 타입은 BE(Pydantic)·FE(TS) 골든 픽스처로 동기화(시안 `v11-numeric.json`·`wording.json` → `contracts/` 또는 `backend/tests/fixtures`).
- **화면(M1·M2)**: React 컴포넌트가 JSON → 인라인 SVG 그래프 렌더. 반응형 CSS(700px 분기, 데스크톱 좌측 목차).
- **PDF(M3)**: WeasyPrint 유지. 책 전용 HTML 템플릿(시안 `book/index.html` CSS를 이식)을 Python에서 JSON → HTML(SVG 포함)로 생성. **화면과 PDF는 템플릿을 공유하지 않음**(React vs Jinja 없는 문자열/템플릿) — 대신 **SVG 생성 로직을 한 곳에 두지 않으면 어긋나므로**, 그래프 SVG는 백엔드 `member_report_svg.py`가 만들고 화면 API가 같은 SVG 문자열을 내려 FE가 `dangerouslySetInnerHTML` 없이 쓰는 대신 **FE는 자체 React SVG 컴포넌트**를 쓰되 verify에서 좌표 일치(허용오차)를 검사. **결정 필요(기본값)**: 그래프는 FE/BE 각자 구현 + 시안 좌표 골든으로 일치 검증.
- 기존 4쪽 PDF(`report_pdf_service`)는 **유지**하고 `GET /reports/{id}/book.pdf`(회원 본인·승인 리포트만) 신규. 기존 메일 PDF 링크 전환은 후속.
- 접근 제어: 회원 본인 리포트만(`user_id`/`participant_id`), 그룹 집계는 최소 N 서버 가드.

## C. Task 목록 (병렬 묶음)

파일 담당은 겹치지 않게 고정. 같은 파일 동시 수정 금지. 워커=Claude sonnet-5-5 구현, Gemini 검증.

| 묶음 | Task | 담당 경로 | 선행 |
|---|---|---|---|
| **P0 (순차, 1명)** | T0 데이터 계약: `member_report` 스키마(BE Pydantic·FE TS)·시안 골든 픽스처 추출 | `backend/app/schemas/member_report.py`, `frontend/src/lib/member-report/types.ts`, `backend/tests/fixtures/member_report/` | — |
| **P1 (BE, 병렬)** | T1 지표 집계 서비스(중앙값·전후·안정된 5분·LF/HF 흐름·결측 판정) | `backend/app/services/member_report_metrics.py` + 테스트 | T0 |
| | T2 그룹 분포 집계 + 최소 N 가드 | `backend/app/services/member_report_group.py` + 테스트 | T0 |
| | T3 1/f 기울기 산출 가능성 확인 및 구현(불가 시 결측 처리) | `backend/app/services/member_report_aperiodic.py` + 테스트 | T0 |
| | T4 문장 생성 규칙·금지어 검사·Gemini 초안 연결 | `backend/app/services/member_report_wording.py`, `member_report_narrative.py` + 테스트 | T0 |
| **P2 (BE 통합, 1명)** | T5 `report_task` 연결(`content.member_report` 저장)·회원용 조회 API·`book.pdf` 엔드포인트 | `backend/app/tasks/report_task.py`, `backend/app/api/v1/reports.py`(소폭) | T1~T4 |
| **P1' (PDF, 병렬)** | T6 책 PDF 렌더(18쪽 템플릿·SVG·명조 임베드·축약판) + 글꼴 번들 | `backend/app/services/member_report_book.py`, `member_report_svg.py`, `backend/app/assets/fonts/NotoSerifKR*`, 테스트 | T0 |
| **P1'' (FE, 병렬)** | T7 모바일(390)·데스크톱(1440) 화면 컴포넌트(한 벌 반응형, 좌측 목차) | `frontend/src/components/member-report/**` | T0 |
| | T8 진입 경로: 회원 클래스 회차 → 리포트, `/app/reports/:id`, PDF 받기(앱 WebView 포함) | `frontend/src/pages/client/**`(회원 리포트 관련 파일만), `App.tsx` 라우트 1줄 | T7 |
| **P3 (검증, 구현자와 분리)** | T9 verify.md 시나리오 실행: 금지어·쪽수·픽셀 근사·결측·dev E2E | `frontend/e2e/member-report*.spec.ts`, `backend/tests/test_member_report_*.py` | T5~T8 |
| **P4** | T10 summary.md, PR(`[SDD-327] 회원 개인 명상 리포트 v11`) | `specs/sdd-327-member-report-v11/summary.md` | T9 |

병렬 가능: T1·T2·T3·T4·T6·T7는 T0 이후 동시. T5·T8은 후속 통합. 브랜치: 단일 PR이면 `sdd/327-member-report-v11` 위 워크트리 분리(`sdd/327-be`·`-fe`·`-pdf` → `sdd/327-integrate`).

## D. 위험

- 1/f·안정된 5분은 신규 산출이라 값 검증 필요(시안 샘플로 골든).
- 18쪽 PDF의 WeasyPrint 렌더 시간(캐시·Celery 렌더 고려) — 기본값: 요청 시 렌더 + content 해시 캐시, 5초 초과 시 비동기 전환은 후속.
- 서버 글꼴 번들 용량 증가(Noto Serif KR 서브셋 사용).

---

## E. 공유 메일 보내기 (추가, 2026-11-13)

### E1. 현 구조 (직접 확인)
- `POST /reports/{id}/resend-email` — `require_roles("counselor","org_admin")` + `require_report_host`, 서비스 `report_email_service.resend_report_email`. 토큰 `_token("report_view", report_id, session_id, email=등록이메일)`(7일 JWT), 열람 시 `participant.report_email == claims.email` 검사 → **다른 주소 수신자 토큰과 호환 안 됨(공유용 신규 토큰 필요)**.
- 발송은 Celery `email_app`(`report_email_task.py`, 큐 email). 재발송은 현재 동기 `send_report_email` 호출.
- Redis는 `core/redis.py`(asyncio 클라이언트) — 동기 라우트용 rate limit은 동기 `redis.Redis.from_url(settings.redis_url)` 헬퍼를 별도 작성(기존 비동기 싱글턴 건드리지 않음).

### E2. API 설계
- **신규** `POST /me/reports/{report_id}/share-email` (회원) 와 기존 `POST /reports/{id}/resend-email` 을 **단일 서비스 함수 `report_share_service.share_report(report_id, actor, recipients, attach_pdf, message, db)`** 로 합친다. 권한 분기는 라우터에서 끝낸다(회원=`participant.user_id == actor`, 상담사=`require_report_host`), 서비스는 actor 종류만 받는다. 이유: 두 경로의 검증·토큰·큐 로직 중복 방지, 권한 구멍 최소화.
- 기존 `resend-email`은 **하위 호환 유지**(단일 `email` 필드 → 내부에서 `recipients=[email]`로 위임). 응답 `{success,sent,message}` 계약 불변. 프론트는 신규 시트로 전환하되 기존 계약 테스트는 그대로 통과.
- 요청: `{recipients: [EmailStr] (1~3), attach_pdf: bool=true, message: str|null (≤200), acknowledged: true(필수)}`. 응답: `{accepted: [{masked, status:"queued"}], rejected:[{masked, reason}], remaining_today}`. 발송은 **비동기 큐잉만** 하고 응답(202 계열 의미) — 최종 성공/실패는 이력에서 확인.
- `GET /me/reports/{report_id}/share-history` — 본인 발송 이력(최근 50건).
- 열람: 기존 `/report-view?token=` 라우트 재사용, 토큰 kind `report_share` 분기 추가(`get_report_view_content`가 kind별 검증).
- 책 PDF: 회원 첨부는 `member_report_book`(T6) 렌더 결과 재사용 — 서비스 내부 함수 호출(HTTP 아님), content 해시 캐시 적중 시 재렌더 없음. 8MB 초과 시 첨부 생략 + `attached=false` 기록.

### E3. 토큰 범위 (받는 주소 바인딩)
- `_token("report_share", report_id, session_id, rcpt=sha256(lower(주소)+JWT_SECRET)[:32], jti=uuid4, sender=participant_id|user_id)` · 7일 만료(기존 `_token` 재사용, claims만 추가).
- 열람 시 `rcpt`는 *링크가 발송된 주소의 해시*이므로, 뷰 페이지는 주소를 직접 비교할 수 없다(로그인 없음). 따라서 **바인딩 = 주소별로 토큰을 따로 발급(수신자마다 다른 `jti`/링크)** + 이력 테이블의 `jti` 대조로 "발급된 링크인가"·"만료/차단 여부"를 확인. 주소 해시는 감사·추적용(어느 수신자 링크인지)이다. **한계 명시**: 링크 재전달은 막을 수 없음 → 확인 문구 + 후속(회수 버튼, `revoked_at` 컬럼은 지금 넣어 둠).
- 열람 응답은 본문 전체(`_serialize`) 대신 회원 리포트 v11 계약(`content.member_report`) 읽기 전용 + 편집·재공유 UI 숨김.

### E4. Rate limit (Redis)
- 키: `rl:share:day:{user_id}:{YYYYMMDD(KST)}` INCRBY(수신 주소 수), TTL 36h → 초과 시 429. `rl:share:rcpt:{sha256(주소)[:16]}` SET NX EX 60 → 1분 내 같은 주소 재발송 거부(`reason:"too_soon"`).
- 상담사·기관관리자: 일일 상한 없음 대신 별도 높은 상한(기본 100/일) — **결정 필요(기본값)**.
- Redis 장애 시: fail-closed(발송 거부, "잠시 후 다시") — 남용 방지 우선.

### E5. 발송 이력 저장 — 마이그레이션 필요
- 선택: **새 테이블 `report_share_events`** (JSONB 불채택). 이유: `reports.content`는 리포트 재생성(`report_task`)이 덮어쓸 수 있고, 수신자별 jti·상태 갱신·상한 집계·감사에 행 단위가 적합. 컬럼 최소: `id uuid pk, report_id fk, sender_user_id, sender_role, recipient_masked, recipient_hash, jti, attached bool, status(queued|sent|failed), error_code, created_at, sent_at, revoked_at null`. 인덱스 `(report_id, created_at desc)`, `(sender_user_id, created_at)`. 주소 원문 **저장 안 함**(마스킹+해시만; 발송은 큐 인자로만 전달 후 폐기).
- Alembic 리비전 1개(`f56a0b1c2d3e` 다음 head 확인 후). 롤백 = 테이블 drop. 감사 로그는 기존 로거 + 이 테이블.

### E6. Celery 재사용
- 신규 태스크 `report_share_email_task(event_id, recipient_email_ref)` — 큐 `email`, 기존 `mindbreeze-email-worker` 재사용(워커 신규 불필요). 주소 원문은 태스크 인자로 전달(브로커 TTL 짧게), 처리 후 이벤트 상태 갱신. 재시도 3회(지수), 최종 실패 시 `status=failed` + 이력에 "발송 실패 — 다시 보내기".
- 워커 미기동: 큐잉은 되지만 장시간 `queued` → 이력에 "발송 대기 중" 표시, 10분 초과 시 "지연되고 있어요. 잠시 후 다시 확인해 주세요". 큐 상태 사전 점검(`/health` 계열 inspect ping) 실패 시 응답에 `delivery_delayed=true` 힌트.
- 메일 템플릿: `report_share_email_template.py`(HTML+텍스트 대체본, 금지어 검사 함수 재사용 T4 `member_report_wording`).

### E7. Task 목록 (T11~, 기존 T0~T10 이어 붙임)
| 묶음 | Task | 담당 경로 | 선행 |
|---|---|---|---|
| **S0 (순차, 1명)** | T11 마이그레이션 `report_share_events` + 모델 + 스키마(Pydantic·TS 타입) | `backend/alembic/versions/*share_events*`, `backend/app/models/report_share_event.py`, `backend/app/schemas/report_share.py`, `frontend/src/lib/api/report-share.types.ts` | T0 |
| **S1 (BE, 병렬)** | T12 `report_share_service`(권한·검증·토큰·rate limit·큐잉) + 라우터 2종 + 기존 resend 위임 | `backend/app/services/report_share_service.py`, `backend/app/api/v1/reports.py`(소폭)·`me` 라우터 | T11 |
| | T13 Celery 태스크 + 메일 템플릿 + PDF 첨부 연결(8MB 판정) | `backend/app/tasks/report_share_email_task.py`, `backend/app/services/report_share_email_template.py` | T11, T6 |
| | T14 공유 토큰 열람 분기(`report_share`) + 만료·차단 검사 | `backend/app/services/report_email_service.py`(해당 함수만) | T11 |
| **S1' (FE, 병렬)** | T15 보내기 시트 컴포넌트(칩 입력·토글·메시지·확인 체크·상태 화면) + 진입 버튼 + 발송 이력 카드, 상담사 재발송 UI 대체 | `frontend/src/components/report-share/**`, `ReportDetailView.tsx`(재발송 블록 교체만), API 클라 `frontend/src/lib/api/reports.ts` | T11(타입), 디자인 시안 |
| | T16 앱 "다른 앱으로 공유"(Capacitor Share + 파일 저장) — 난도 높으면 **후속 분리** | `frontend/src/lib/native-share.ts` | T15 |
| **S2 (검증, 분리)** | T17 verify §W 시나리오 실행: BE 테스트 + dev E2E(Gemini) | `backend/tests/test_report_share_*.py`, `frontend/e2e/report-share.spec.ts` | T12~T15 |
| **S3** | T18 summary 반영·PR 합류(기존 T10과 통합) | `specs/.../summary.md` | T17 |

병렬: T12·T13·T14·T15는 T11 이후 동시(담당 경로 겹침 없음; `reports.py`·`report_email_service.py`는 각각 T12/T14만 수정). 기존 T5(`reports.py` 소폭)와 같은 파일이므로 **T12는 T5 머지 후 또는 별 함수 영역만 수정**해 충돌 회피.

### E8. 위험
- 공유 링크 재전달 → 회수 없음(후속). 고지·감사로 보완.
- 메일 첨부 용량(18쪽 책 PDF)·스팸 분류 → 8MB 초과 시 링크만, SPF/DKIM은 기존 발신 도메인 설정 의존(확인만).
- 일일 상한 우회(다계정) → 상한은 user 기준 + 주소 기준 1분 간격, 이상 징후는 후속 모니터링.
