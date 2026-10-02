# [SDD-099] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 큐시트 없이 클래스 생성이 정상 동작한다
1. `POST /api/v1/sessions` (cuesheet 필드 없이) 호출
2. 응답 201, `cuesheet` 키가 응답에 **없음**을 확인
- **Expected:** 생성 성공, 응답에 `cuesheet` 필드 미노출

### TS2: 큐시트를 포함해 생성해도 무시/허용된다
1. `POST /api/v1/sessions` 에 `cuesheet: [...]` 를 넣어 호출
2. 응답 확인
- **Expected:** Pydantic 기본 설정상 무시되거나(extra 허용) 422가 아니어야 하며, 서비스가 큐시트를 저장·노출하지 않음. (기존 계약상 extra 필드는 무시되므로 201 + 미노출이 기대)

### TS3: 목록·상세·복제·템플릿 응답에 cuesheet 없음
1. 클래스 생성 → 목록/상세/복제/템플릿 저장 호출
2. 각 응답에서 `cuesheet` 키 부재 확인
- **Expected:** 모든 응답에 `cuesheet` 미포함

### TS4: DB 컬럼 제거 마이그레이션
1. `alembic heads` 실행 → 단일 head
2. `alembic upgrade head --sql` 렌더로 `DROP COLUMN sessions.cuesheet` 포함 확인
- **Expected:** 단일 head, drop SQL 정상 렌더

### TS5: 백엔드 전체 테스트 무회귀
1. `pytest` 실행
- **Expected:** 큐시트 테스트 제거 후에도 기존 세션/복제/템플릿/리마인더 테스트 전부 통과

### TS6: 프론트 생성 폼에서 큐시트 UI 사라짐
1. 클래스 생성 페이지 렌더
- **Expected:** "진행 큐시트" 에디터 미노출, 폼 제출 정상

### TS7: 상담사 플레이어에서 큐시트 패널 사라짐
1. in_progress 상담사 플레이어 렌더
- **Expected:** `CuesheetPanel` 미렌더, 나머지 라이브 UI(모니터/녹음/가이드 등) 정상

### TS8: 프론트 빌드·타입·테스트 통과
1. `npm run build`, `npx tsc -b`, `npm test` 실행
- **Expected:** 0 errors, vitest 무회귀

## Edge Cases
- [ ] `classElapsedSec` 등 큐시트와 공유되던 진행시간 변수가 다른 지표에 계속 쓰이는지 확인(오삭제 방지)
- [ ] `SessionDto` 타입에서 `cuesheet` 제거 시, 이를 참조하던 다른 컴포넌트(플레이어 외)가 없는지 grep 검증
- [ ] 이미 배포된 환경에서 drop 마이그레이션이 정상 적용(기존 데이터 유실은 허용된 범위)
- [ ] `CuesheetStep` import 잔여로 인한 `tsc` 미사용 import 에러 없음

## Security Review
- [ ] 응답에서 제거된 `cuesheet` 필드가 다른 응답 스키마에 남아 노출되지 않음
- [ ] drop 마이그레이션이 기존 데이터에 부작용 없이 컬럼만 제거(별도 PII 없음 — 큐시트는 상담사 입력 텍스트로, 제거 허용 범위)
