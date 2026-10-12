# SDD-071 구현 계획

목표: 종료된 단일 세션의 참가자 한 명에 대해 원천 feature 및 완료 참가자 리포트를 비동기 ZIP으로 제공한다.
설계: DataExportJob과 별도 감사 원장을 PostgreSQL에 저장하고, Celery export 큐에서 배치 조회·임시 파일·S3 업로드를 수행한다. API는 요청자와 현재 원천 접근권한을 매번 확인하며 GET 서명은 실제 자격증명이 없으면 실패한다.
기술: FastAPI/SQLAlchemy/Celery/boto3, React/TypeScript.
근거: spec.md 및 docs/data-download-기획.md P0.

## 작업
1. `backend/tests/test_data_exports.py`: 참가자 분리, 게스트, null/정밀도/구간 재시작, 허용 필드, 권한·멱등·만료·저장소 실패 테스트를 먼저 작성하고 RED 실행.
2. `backend/app/models/data_export.py`, Alembic migration, models 등록: 작업·감사 테이블, 요청자별 멱등키 고유 제약, 상태·시간·크기·해시 저장.
3. `backend/app/services/export_service.py` 및 패키지 serializer: 종료 세션·현재 사용자 활성 상태·역할·호스트·참가자 범위 확인. 작업 시작과 게시 직전 권한/EEG 동의 재검사. 참가자 명시 귀속만 허용하고 레거시 불명 귀속은 포함하지 않음.
4. `backend/app/services/storage_service.py`: 엄격한 S3 업로드/GET 서명/삭제. 24시간 객체 보관, URL 최대 300초 및 패키지 만료시각 제한. 명시 만료 삭제 정기 태스크 추가.
5. `backend/app/api/v1/data_exports.py`, schemas 및 router 등록: 생성 202, 상태, 다운로드 URL. 동일 키·동일 요청 재사용, 다른 요청 409. 생성자만 작업 열람, org_admin 명시 403.
6. `backend/app/tasks/export_task.py`, celery 등록: export 전용 큐·중복 실행 방지·실패 원장·감사 이벤트. 임시 파일은 작업 후 정리하고 무한 메모리 적재를 피함.
7. `frontend/src/components/reports/DataExportButton.tsx` 및 API 모듈: 목적 입력, 요청/상태 폴링, 경고 및 만료 안내, 브라우저 S3 직접 다운로드. 공용 리포트 상세 PDF 옆에 연결하되 인증 상담사/플랫폼 및 명시 participant_id만 허용.
8. targeted pytest → backend 전체 pytest → frontend build. summary.md에 실행 결과 및 실제 S3/운영 DB 검증 경계를 기록.

## 고정 계약
- 8 주요 지표 + 9 밴드파워/부가 + 8 HRV/움직임 = 숫자 25개, window_index/quality/device_timestamp_ms/play_group_id를 합쳐 CSV 29개 컬럼.
- null은 빈 셀, 숫자 반올림·보간·정규화 금지. CSV 품질값과 구간별 window_index 유지.
- report.json은 type/status/data_credibility/content.eeg(metrics/timeline/narrative)만. 이름·이메일·상담 본문·raw·음성 제외.
- 가명 session=s001, participant=p001은 작업 내부에서만 의미를 가짐. README는 가명화가 익명화가 아님을 명시.
- 수집 동의가 내보내기/연구 활용의 포괄 허가를 뜻하지 않음. P0는 기록된 목적과 현재 EEG 수집동의 재확인을 적용하며 별도 연구 반출 권한을 주장하지 않음.
- 운영 DB 마이그레이션 적용, 커밋, 배포는 수행하지 않음.
