# SDD-261 — 데이터 저장·업로드 현황 구현 계획

> 구현 담당: 감독 승인 후 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 작업별 수행한다. 현재는 기획만 작성하며 구현을 시작하지 않는다.

**목표:** 앱을 변경하지 않고 브라우저에서 회차 참여자별 서버 저장 현황을 조회한다.
**구조:** 단일 회차 배치 API → 공통 조회 훅/테이블 → 설정 및 클래스 관리 두 진입점. 기존 수집 파이프라인은 변경하지 않는다.
**기술:** FastAPI/SQLAlchemy/PostgreSQL, React/TypeScript, 기존 UI 토큰과 조회 패턴.
**정본:** `specs/sdd-261-upload-status-screens/spec.md`.

## 공통 제약·승인 경계

- 현재 산출물은 spec/plan만. verify는 감독 승인 후 구현 전에 작성한다. summary는 실제 검증 결과로 작성한다.
- 11/4 전 MVP는 웹+BE만. 네이티브/measurement-core/수집 로직 변경 금지. designs/는 디자인 담당 소유.
- 서버 수신 기준 명시, 기대 수 null, 폰 보고 null. 100% 완료 및 리포트 생성 가능 확정 금지.
- 미수신과 미착용 구분, 개인정보 최소화, 이름 기존 규칙 유지, 점수·좋음/나쁨 없음.
- 이번에는 문서 로컬 커밋만. 이후 푸시/PR/배포는 이번 승인에 포함되지 않는다.

## 리뷰 집중 영역

| 위험 | 담당 작업·검증 조건 |
|---|---|
| 다른 기관 또는 보조 코치에 데이터 공개 | BE-1/QA-1: 401/403/404, 동일 기관이나 담당 아닌 코치도 차단 |
| 0건·연결 끊김을 미착용 또는 완료로 표시 | BE-1/FE-1: null·unknown 유지, 미수신 문구 |
| 다중 stream/legacy/1-based 때문에 잘못된 결측·분모 | BE-1: stream별 내부 공백만 계산, 기대 수 null |
| JOIN 행 증가·폴링 중 80회 조회 | BE-1/QA-1: SQL 횟수 상한, 원시·feature 독립 집계 |
| 오래된 화면·권한 변경·앱 내장 화면 혼동 | FE-1/QA-1: 오류·오프라인·복귀·403 데이터 제거 및 브라우저 배포 경로 |

## 파일 소유 및 인터페이스

아래 신규 파일은 구현 예정 경로이며 아직 생성하지 않는다. 공유 파일은 표의 단일 담당만 수정한다.

| 작업 | 단독 소유 파일 | 입력→산출 |
|---|---|---|
| BE-1 | 신규 `backend/app/services/upload_status_service.py`, `backend/app/schemas/upload_status.py`; 기존 `backend/app/api/v1/classes.py` 라우터; 신규 `backend/tests/test_upload_status.py` | JWT·class_id·session_id → spec §3 JSON. `get_upload_status(db, actor, class_id: UUID, session_id: UUID) -> UploadStatusResponse` |
| FE-1 | 신규 `frontend/src/lib/api/upload-status.ts`, `frontend/src/hooks/use-upload-status.ts`, `frontend/src/components/class/upload-status-table.tsx`, `frontend/src/pages/settings/upload-status-page.tsx`, `frontend/src/pages/classes/class-upload-status-page.tsx`; 기존 `frontend/src/components/settings/settings-content.tsx`, `frontend/src/pages/classes/host-class-detail-page.tsx`, `frontend/src/App.tsx`; 신규 `frontend/tests/sdd261-upload-status.test.tsx` | `fetchUploadStatus(classId, sessionId, signal): Promise<UploadStatusResponse>`; 공유 훅 `useUploadStatus(classId, sessionId)` → 두 화면. 프런트 DTO는 spec JSON과 일치 |
| QA-1 | 신규 `frontend/e2e/class-structure/sdd261-upload-status.spec.ts`, 기존 `frontend/e2e/class-structure/playwright.config.ts`의 testMatch, `backend/tests/test_upload_status_integration.py`, `specs/sdd-261-upload-status-screens/verify.md` 및 검증 후 `summary.md` | 승인된 spec → 사전 시나리오, 권한/API/실화면/쿼리·성능 결과 |
| 디자인(별도 워커) | `designs/` | 기존 토큰 기반 시안. 본 담당은 읽기 검토만 |

BE와 FE는 spec의 응답 필드/enum을 계약으로 병렬 가능. 계약 변경은 두 문서부터 동기화한다. QA는 구현자와 분리하며 감독이 diff와 실제 테스트 출력을 재확인한다.

## BE-1 — 회차 전체 읽기 API

- [ ] 권한 실패·타 기관·클래스/회차 불일치·게스트/미수신 포함 테스트 작성. 0건·NULL legacy·다중 stream·1-based 1,2,4→내부 결측1·서버 등록 pending/failed 케이스를 포함한다.
- [ ] `cd backend && pytest tests/test_upload_status.py -q`로 미구현 실패를 확인한다.
- [ ] spec §3 DTO/권한 검사를 구현하고 독립 집계 쿼리와 상태 우선순위를 구현한다. raw 신호 3종을 0건으로 채우되 폰 대기량/기대 수는 null로 유지한다.
- [ ] 조회 중 참가자 변경에도 한 스냅샷을 반환하도록 트랜잭션 범위를 구성한다. read-only가 기존 요청 트랜잭션에 충돌하지 않는지 통합 테스트한다.
- [ ] 단위 테스트를 통과시키고 QA에 API·쿼리계획을 인계한다. 기존 summary API 동작은 변경하지 않는다.

## FE-1 — 공유 테이블과 두 진입점

- [ ] fixture 기반 테스트: 두 경로 같은 응답, 이름 검색/상태 필터/그룹, 회차 없음/참여자 없음, 0건=미수신, band_connected=false≠미착용, raw 10/10≠100% 완료를 작성한다.
- [ ] `cd frontend && npx vitest run tests/sdd261-upload-status.test.tsx`로 실패를 확인한다.
- [ ] DTO·fetch 함수·훅·테이블을 구현한다. 인증은 기존 API 클라이언트 사용, 회차 선택 목록은 기존 접근 가능 클래스/회차 조회를 재사용한다. 기관관리자 접근 범위를 프런트 필터만으로 보장하지 않는다.
- [ ] 진행 10초/종료 30초, 오류 backoff 10/20/40/60초, visibility/offline 중단·복귀 즉시 조회·수동 중복 방지·변경 시 AbortSignal 취소를 구현한다. 403에서는 이전 이름/건수도 제거한다.
- [ ] 설정 링크와 회차 목록 링크, 두 신규 경로의 counselor/org_admin RoleGuard를 추가한다. 부모 경로 클래스 > 회차(담당 상담사)를 유지한다.
- [ ] 테스트 통과 후 `npm run build`로 빌드 확인. 데스크톱 상세와 모바일 핵심 열은 QA가 실제 브라우저에서 확인한다.

## QA-1 — 독립 검증과 인계

이 목록은 계획상의 작업 범위이며 Stage ③ verify를 대체하지 않는다.

- [ ] 감독 승인 후 **코드 수정 전** verify.md 작성. spec의 역할·표시·정확성·오프라인·성능·모바일 시나리오를 승인된 체크리스트로 고정한다.
- [ ] 기존 Playwright 설정의 testMatch는 read/visual 두 파일만 허용하므로 신규 sdd261 파일을 명시 추가한다. 기존 테스트는 보존한다.
- [ ] 합성 PostgreSQL fixture로 40명×1시간 feature 및 3신호 raw를 생성한다. 파일/운영DB/실개인정보를 사용하지 않는다. SQL 로그 카운터로 1명/40명 모두 최대8회, EXPLAIN ANALYZE 및 30회 응답 p95<1초 목표를 기록한다.
- [ ] 독립 COUNT/DISTINCT 및 stream별 집합 차이 계산으로 API 결과와 대조한다. 재전송 중복·중간 공백·선두/꼬리 미상·NULL legacy·pending→uploaded 변경을 포함한다. 기존 summary를 정답 함수로 호출하지 않는다.
- [ ] `cd backend && pytest tests/test_upload_status.py tests/test_upload_status_integration.py -q`; `cd frontend && npx vitest run tests/sdd261-upload-status.test.tsx`; `npx playwright test --config e2e/class-structure/playwright.config.ts sdd261-upload-status.spec.ts` 실행. 프로젝트 실제 Playwright 설정에 따른 로컬 fixture 서버만 사용한다.
- [ ] PC 1440px/모바일 390px에서 실제 캡처: 두 경로, 필터 유지, 긴 이름, 오류/오프라인/403. API 응답·네트워크 호출 수·브라우저 문구를 함께 기록한다. 빌드 통과를 동작 증거로 대체하지 않는다.
- [ ] summary.md에 통과/실패/미검증, 배포 미수행, 앱 실기기 미검증을 기록하고 감독에게 인계한다. 폰 종료 대조까지 검증했다는 주장은 별도 실기기 증거 없으면 금지한다.

## 제안 일정(KST, 승인 지연 시 압축하지 않고 재판단)

| 시각 | 담당·작업 | 종료 조건 |
|---|---|---|
| 11/1 | 기획·디자인 → 감독 | spec/plan 및 별도 시안 검토. 문서만 로컬 커밋 |
| 11/2 09:00~10:00 | 감독·QA | 범위 승인, 구현 전 verify 작성 |
| 11/2 10:00~16:00 | BE/FE 병렬 | 계약 테스트와 단위 검증 통과. 12:00 앱 동결에 영향 없음 |
| 11/2 16:00~19:00 | 독립 QA·감독 | API/권한/40명 부하/2화면 실제 검증, 발견 결함 재검증 |
| 11/2 19:00~21:00 | 감독 | 승인 시 별도 배포 담당이 Web+BE 배포·현장 URL 확인. 본 기획 작업 범위 아님 |
| 11/2 22:00 | 서버 동결 | 미통과면 연기. 운영/개발 배포 승인 구분 |
| 11/3~11/4 | 현장 운영 | 브라우저 계정/URL 준비 및 기존 폰 종료 대조 절차 확인 |
| 11/4 이후 | 후속 SDD | 폰 보고 경로·종료 manifest/sequence 정합·착용 이력·완전성 대조 |

## 자기 검토 결과

spec §1 현황 교정은 구현 전 참고, §2 화면은 FE-1, §3 API는 BE-1, §4 보고 경계는 양쪽 null 계약, §5 일정은 위 표, §6 결정/미확인은 감독 검토로 연결했다. 구현·실행 결과는 아직 없다. 라우터 및 테스트 디렉토리 연결은 착수 시 실제 저장소 설정을 재확인한다.
