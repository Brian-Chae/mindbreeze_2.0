# SDD-241 — 연구 사본 메타데이터 구현 계획

> 실행: superpowers:subagent-driven-development와 test-driven-development. 구현과 검증을 분리한다.

**목표:** 확정 메타데이터를 추가하면서 참여자 개인정보 금지와 구동의 범위를 보존한다.
**구조:** exporter 안의 명시적 Arrow 스키마와 순수 메타데이터 변환 함수, 동의 범위별 namespace. 진행자는 별도 테이블.
**기술:** SQLAlchemy, pyarrow, pytest(SQLite/메모리 저장소), React/TypeScript, vitest.
**Spec:** [spec.md](spec.md)

## 공통 제약

- 생년월일: 연·월까지만(birth_year_month 유지, 일자 제외).
- UTC ISO8601 절대시각 + KST 환산 컬럼. 근거 없으면 null + 사유.
- 진행자 실명 + 실제 user id + 계정 역할 및 회차 역할.
- 서버·실DB·환경파일 접근 금지. 테스트 설정은 dotenv 로더를 비활성화한 별도 실행기로 격리.
- 머지·develop push·배포·데이터 삭제·메일 금지. 기존 동의 자동 승격 금지.

## 검토 초점

1. 동명이인/참여자와 진행자 이름 충돌: 참여자 PII 보호 우선.
2. raw의 비유한 수치·장비 재시작·잘못된 epoch·missing endpoint: 절대시각 추측 금지.
3. 신구 동의가 같은 세션에 섞일 때 session/participant 가명으로 새 메타데이터 연결 금지.
4. 회차 한정 강사·제거된 강사·담당 상담사: 진행 관계 원천을 명시하고 과거 출석으로 단정 금지.
5. 동의 상속/버전 누락·동의 이전 회차: 확장 허용 금지.

## 담당 파일 및 순차 작업

### Task 1 — 백엔드 번들 계약 (구현 워커)

파일: `backend/app/services/research_export_service.py`, `backend/tests/test_sdd241_research_export_metadata.py`, 관련 기존 exporter 테스트.
입력: `build_session_bundle(db, session_id)` 기존 인터페이스. 출력: 기존 export/ack 유지, 2.0 manifest와 facilitators 파일.
- [x] 새 필드 값·정확한 UTC/KST·구동의 격리·null 사유·공동진행·enum·PII·해시 테스트 추가.
- [x] RED 실행해 기존 계약과의 실패 확인.
- [x] ALLOWED/Arrow schema/row builder/enum/스캔/해시/manifest 구현.
- [x] 관련 pytest GREEN 확인. 기존 테스트는 과거 동의 범위를 유지하면서 5번째 파일 계약만 갱신.

### Task 2 — 고지와 동의 범위 (고지 워커, Task 1 후 순차)

파일: `frontend/src/lib/privacy-policy.ts`, 연구 상세·요약 노출 및 버전 상수, `backend/app/services/research_consent_service.py`와 가입/클래스 동의 상속 관련 서비스(필요 시), 관련 테스트, `facilitator-notice-draft.md`.
인터페이스: 확장 고지 `r5-2`; 버전 미전달과 기존 상속은 r5-1/기존 버전 보존.
- [x] 관련 테스트 RED: 새 고지 항목과 구버전 자동 승격 금지.
- [x] 참여자 고지에 진행자 실명·계정 ID·역할, 시작·종료, 프로그램 세부 반영. HMAC 설명 정정.
- [x] 진행자 약관·고지 위치 조사 결과와 본인 대상 고지 초안 기록. 동의 UI 신규 구현 금지.
- [x] 관련 pytest/vitest GREEN 확인.

### Task 3 — 독립 검증 및 인계 (감독 + 검증 워커)

- [x] diff·스펙 충족·실제 Parquet/manifest 생성 결과 독립 확인, 리뷰 지적 수정.
- [x] 백엔드 전체 회귀 실행. 실패는 변경 영향/기존 환경 한계 구분.
- [x] 프론트 관련 vitest와 타입 검사 실행.
- [x] verify 실행 결과와 summary(필드·원천·법적 위험·미검증 사항) 작성.
- [ ] 한글 feat(sdd-241) 커밋, 작업 브랜치 push, 지정 제목의 develop 대상 PR 생성.

## 구현 결정

같은 워크트리에서 워커 변경 작업은 순차로 수행하고 감독만 git index/커밋을 관리한다.
현재 클래스 강사 관계는 실제 출석 이력이 아니므로 manifest에서 provenance를 명시한다.
진행자 동의 증빙 체계 미구현은 확정 범위에 따른 잔여 위험으로 기록한다.

## 실행·리뷰 기록

- 구현 전 문서 커밋: `2f2b4b14` (spec·plan·verify, 제품 코드 변경 전).
- Task 1: 최초 신규10건 RED 후 구현. 독립 리뷰 Important 1건(서로 다른 stream_id 정렬을 시계 역행으로 오판) 발견 → 스트림별 검사로 수정, 회귀 RED2건 후 관련50건 GREEN. 재리뷰 지적 해소.
- Task 2: FE 신규2건/BE 신규 재동의1건 RED 후 구현. 요약 카드 실제 DOM 추가 RED1건 후 수정. 독립 리뷰 Critical/Important 없음.
- 구현 정밀화: 원본 권장안의 class_pseudo 포함. 당시 공동 진행자 누락을 줄이기 위해 현재 active 관계뿐 아니라 추가·제거 기간이 회차와 겹치는 관계를 포함한다. 실제 출석 증명과 당시 프로필 복원은 하지 않는다.
- 보수적 범위 결정: 가입 boolean-only는 어떤 버전 고지를 보았는지 확인 불가하므로 Consent1.0 유지. 잘못 판단하면 가입 동의만 한 연구 자료의 확장 메타데이터가 누락될 수 있으나 구동의의 과잉 반출은 막는다.
- Task 3의 전체 회귀·최종 커밋·PR 상태는 summary와 verify의 실제 결과를 따른다. 실행되지 않은 작업은 성공으로 간주하지 않는다.
