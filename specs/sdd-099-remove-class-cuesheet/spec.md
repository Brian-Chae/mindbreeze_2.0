# [SDD-099] 클래스 진행 큐시트(타임라인 대본) 기능 제거

## Goal
클래스(명상/상담)의 "진행 큐시트" 기능을 프론트·백엔드 전 구간에서 제거한다. 생성 폼 작성기, 상담사 플레이어 패널, API 계약, DB 컬럼, 관련 테스트를 모두 정리한다.

## Context
- "진행 큐시트"는 상담사가 명상 클래스 흐름(도입 호흡 → 바디스캔 → 마무리)을 단계별 라벨·목표시간·메모로 미리 적어 두고, 상담사 플레이어에서 현재 단계 하이라이트·남은 시간 진행바로 보여 주는 기능이다.
- Brian 판단: 클래스 진행에서 실사용 가치가 낮아 불필요. 전체 기능 제거 요청.
- 현재 상태: 백엔드(모델·스키마·서비스·마이그레이션 `e036a0000020`·QA 테스트)와 프론트(생성 폼 `CuesheetEditor`, 상담사 플레이어 `CuesheetPanel`, 순수 로직 `cuesheet.ts`, API 타입, 테스트 2종)에 구현 완료되어 있음.

## Scope

### ✅ In-scope
- 백엔드 제거
  - `backend/app/models/session.py` — `Session.cuesheet` 컬럼 제거
  - `backend/app/schemas/session.py` — `CuesheetStep`, `CUESHEET_MAX_STEPS`, cuesheet 필드 3곳(create/update/response) 제거
  - `backend/app/services/session_service.py` — `_cuesheet_steps`, `_copy_cuesheet`, 직렬화·생성·템플릿·복제·수정의 cuesheet 처리 제거
  - `backend/tests/test_class_cuesheet.py` — 삭제
  - `backend/alembic/versions/` — `sessions.cuesheet` drop 마이그레이션 신규 추가 (기존 `e036a0000020`은 히스토리 보존)
- 프론트 제거
  - `frontend/src/lib/class/cuesheet.ts` — 삭제
  - `frontend/src/components/session/CuesheetEditor.tsx` — 삭제
  - `frontend/src/components/class/CuesheetPanel.tsx` — 삭제
  - `frontend/src/lib/api/session.ts` — `CuesheetStep`, `CUESHEET_MAX_STEPS`, cuesheet 필드 3곳 제거
  - `frontend/src/pages/sessions/SessionCreatePage.tsx` — cuesheet 상태·임포트·폼 제거
  - `frontend/src/pages/sessions/ClassPlayerPage.tsx` — `CuesheetPanel` 임포트·렌더링 제거
  - `frontend/tests/cuesheet.test.ts`, `frontend/tests/cuesheet-ui.test.ts` — 삭제
- 문서
  - `docs/클래스-개선-루프-아이디어.md` — 7번(진행 큐시트) 항목 "제거됨" 반영

### ❌ Out-of-scope
- 클래스 상태 머신(ready/open/in_progress/...), 입장·체크인, EEG, 녹음, 리포트, 채팅, 리마인더 등 다른 클래스 기능은 건드리지 않는다.
- 기존 `e036a0000020_class_cuesheet.py` 마이그레이션 파일 삭제·재작성(히스토리 보존을 위해 유지, drop만 추가).
- DB에 이미 저장된 cuesheet 데이터의 별도 보존 처리(기능 제거와 함께 drop).

## Acceptance Criteria
- [ ] 백엔드 `pytest` 전체 통과 (cuesheet 테스트 제거 후 기존 세션 테스트 무회귀)
- [ ] `backend` `alembic heads` 단일 head 유지, 신규 drop 마이그레이션이 체인에 정상 연결
- [ ] 프론트 `npm run build` 0 errors, `npx tsc -b` 0 errors
- [ ] 프론트 `vitest` 통과 (cuesheet 테스트 2종 제거 후 나머지 무회귀)
- [ ] 코드베이스에서 `cuesheet`/`Cuesheet` 참조가 큐시트 기능 관점에서 전부 제거됨 (마이그레이션 히스토리 파일 제외)

## Dependencies
- 없음. 독립 제거 작업.

## Risks
- **마이그레이션 체인 꼬임**: `e036a0000020`(cuesheet)이 `e036a0000021`(report watchdog, head)의 부모 → 기존 파일을 삭제하면 체인이 깨진다. → drop 전용 신규 마이그레이션(`e036a0000022`, down_revision=`e036a0000021`) 추가로 대응.
- **API 응답 계약 잔여**: `SessionResponse.cuesheet` 제거 시 프론트 타입도 동시 제거하지 않으면 런타임/타입 불일치. → BE/FE 동일 커밋에서 함께 제거.
- **`classElapsedSec` 등 공용 변수 오삭제**: 플레이어에서 cuesheet 외 다른 지표에도 쓰이는 변수를 제거하면 회귀. → cuesheet 패널 렌더링·import만 제거하고 공용 변수는 유지.
