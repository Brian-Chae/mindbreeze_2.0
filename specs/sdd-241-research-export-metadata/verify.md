# SDD-241 — 구현 전 검증 시나리오

작성: 2026-10-24, 제품 코드 구현 전. 사용자 지시로 Stage ③~⑥ 연속 진행 승인.
아래는 실행 전 체크리스트이며 통과 표시는 실제 실행 후에만 기록한다.

- [x] V1 기존 birth_year_month YYYY-MM 유지, 생년월일의 일자·참여자 원본 ID·실명·연락처·자유기입명 없음.
- [x] V2 세션 시작·종료 UTC ISO8601와 KST는 동일 순간이며 날짜 경계·소수초 보존.
- [x] V3 개인 시각은 raw 실제 최초/최종 endpoint 근거. feature-only·결측·역전·비유한·범위 밖은 null + 사유.
- [x] V4 1:1 host 실명/user id/계정 역할, 클래스 회차 범위·관계 기간으로 확인 가능한 공동 진행자 목록. 원천 및 현재 스냅샷 제약 명시.
- [x] V5 프로그램 seq/session_kind/schedule_mode/planned_session_count/default_duration_min 값과 null 보존, 자유 문자열 제외.
- [x] V6 enum 미지 값/전화·이메일/참여자 실명 주입은 업로드 0. 진행자 실명 예외는 지정 셀만.
- [x] V7 schema 2.0, ALLOWED/Arrow/manifest 파일·컬럼 일치, 파일별 sha256/목록 해시 재계산 일치.
- [x] V8 세션/개인 시각·프로그램·진행자·raw 메타 변경은 content hash 변경, 중복/acked 자동 재반출 금지 유지.
- [x] V9 신구 혼합 동의 session/participant 가명 분리, 구동의로 새 metadata 조인 불가. 버전 미전달·이전 회차 확장 금지.
- [x] V10 연구 고지 모든 관련 경로에 새 항목·참여자 PII 제외·결합 위험 유지. 구상속 버전 자동 승격 없음.
- [x] V11 상담사 고지는 초안만, 신규 동의 UI 없음. 본인 동의 근거/철회 체계 미확인을 summary 위험으로 기록.
- [x] V12 관련 pytest + 전체 백엔드 회귀 + 프론트 관련 vitest. 실제 Parquet를 재읽어 값·해시 독립 검증.
- [ ] V13 변경 파일·커밋·PR base 확인. 서버/DB/.env·배포·메일·실데이터 작업 없음.

## 실행 결과

V1~V11: 관련 백엔드73건, 프론트96건 및 독립 verify-contract.py로 확인. 구현 전 작성 커밋 `2f2b4b14`.
V12: 백엔드 전체3971 passed/463 skipped/실패0(374.06초), 관련73 passed, 프론트96 passed, 타입·독립 Parquet/manifest 검증 통과. 변경 전 성능1실패는 최종 전체에서는 통과했으며 관련 코드를 수정하지 않았다.
V13: 금지 작업 없음과 변경 범위 확인, 최종 커밋·PR 확인 전이므로 미체크.
실제 DB·S3·Spark·브라우저·장비 시계 검증은 범위 밖이며 체크 표시는 이들의 검증을 뜻하지 않는다.
