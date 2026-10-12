# SDD-071 구현 결과

## 구현 범위

- DataExportJob 작업 원장과 DataExportAudit 감사 원장, Alembic `e036a0000007` 추가. 요청자별 Idempotency-Key 고유 제약, 상태·스키마·기준시각·S3 객체·바이트·SHA-256·만료·오류 저장.
- 종료 세션의 명시 참가자 1명만 처리. 상담사는 현재 host_id 소유 세션, 플랫폼 관리자는 전체 세션에 생성 가능. 작업 상태/URL은 생성자만 허용하고 org_admin은 기관 정책 미확정 403 메시지 제공.
- 현재 DB 활성 계정·역할·세션·참가자·EEG 동의를 생성/작업 실행/게시/URL에서 검사. 상담사 리포트 또는 participant_id=null 레거시를 참가자 자료로 추정하지 않음.
- feature CSV는 숫자 25개 + 식별/시간/품질 4개 = 29개 허용 컬럼. 원천 NULL/0/float 정밀도/quality/구간 재시작 보존. 미측정은 저장된 리포트의 명시 상태로 확인하고 불명은 unknown 유지.
- 참가자 완료 client 리포트의 type/status/data_credibility 및 content.eeg(metrics/timeline/narrative)만 직렬화. 하위 키도 허용 목록 사용. 상담 본문·사용자 프로필·raw·음성 제외.
- ZIP은 manifest, session_metadata, data_dictionary, README_ko 및 participants/p001 데이터로 구성. 파일별 바이트·SHA-256·행수·포함/누락 사유 기록. 가명은 s001/p001, ZIP 객체 경로는 작업 UUID만 사용.
- Celery exports 큐: 원천 REPEATABLE READ 스냅샷, 1,000행 배치·임시 디스크 CSV, ZIP64, S3 암호화 업로드, 게시 직전 재검사. 조건부 상태 UPDATE로 중복 메시지 차단.
- 요청자당 동시 생성 1건, 100,000행/100MiB 상한, 20분 soft/25분 hard limit. 30분 이상 정체 작업은 worker_timeout.
- GET 서명은 스텁 없이 명시 실패, HeadObject 확인 후 TTL 최대 300초 및 패키지 만료 제한. 패키지는 요청 후 24시간에 접근 차단하고 주기 태스크가 객체 삭제/실패 재시도. 원천 삭제 후에도 정리 원장은 유지.
- ReportDetailPage와 모달이 공유하는 ReportDetailView의 PDF 옆에 데이터 다운로드 버튼 연결. 상담사/플랫폼 + participant_id가 있는 경우에만 노출. 목적 입력, 상태 폴링, 경고/실패/만료, 같은 탭 재진입 시 작업 ID 복원, ZIP 직접 S3 GET 지원.
- backend/deploy에 worker/beat systemd 검토용 설정 및 운영 적용 안내 추가. 현재 배포 workflow 자동 설치나 실제 서버 변경은 하지 않음.

## 검증

- 최초 RED: 신규 9건 실패(API/모델/서비스 미구현).
- 확장 테스트 19건: 권한/활성 상태/플랫폼/소유자·동의·종료 세션, 멱등성/큐 실패/지원 옵션, ZIP 허용 필드/타 참가자 분리/null/정밀도/해시/중복 실행, 미측정/불명·리포트 미완료, 업로드 실패/게시 전 철회/URL 수명/삭제 재시도, 마이그레이션 오프라인 SQL.
- 추가 RED에서 마이그레이션의 Text 참조, 정리 원장 CASCADE 삭제 위험, HeadObject 이후 만료 재계산, 미연결 상태의 미측정 오인 재현 후 수정.
- Celery 독립 프로세스 로딩 테스트로 기존 report_task ↔ report_service 순환 import를 재현했다. report_service의 기존 호출 이름은 유지하면서 실제 태스크 함수 import를 호출 시점으로 지연해 worker 시작을 복구했다.
- 역할/권한으로 거부된 생성 요청도 요청자·역할·대상·목적·결과를 감사 원장에 기록한다.
- 전체 테스트 중 신규 Alembic 테스트가 로깅 설정을 바꿔 기존 로그 테스트 3건에 간섭한 것을 확인. Alembic 오프라인 검증을 subprocess로 격리해 해결.
- `cd backend && venv/bin/pytest`: **483 passed, 12 skipped, 14 warnings** (37.94초).
- `cd frontend && npm run build`: **exit 0** (TypeScript + Vite).
- 신규 FE API/컴포넌트 ESLint: **exit 0**.
- `git diff --check`: **exit 0**.

## 미검증·운영 적용 경계

- 실제 AWS upload/HeadObject/presigned GET/버킷 암호화·수명주기, 운영 PostgreSQL 동시 잠금, 배포 worker/beat, 실제 브라우저 저장은 로컬 테스트로 검증하지 않았다.
- 새 migration과 worker/beat 설치·재시작이 운영 적용에 필요하다. `backend/deploy/data-export-운영.md` 참고. 커밋/배포/운영 DB 적용은 수행하지 않았다.
- 기존 리포트 상세 조회 API는 리포트 소유자/세션 호스트만 허용한다. P0 새 export API의 플랫폼 관리자 전체 권한은 구현·테스트했지만 기존 리포트 열람 권한 자체를 확장하지 않았다.
- 세션 전체 상담사 리포트(participant_id 없음)는 참가자 선택 없이 다운로드하지 않는다. 이번 브리프의 FE 범위는 참가자 리포트 상세이며 별도 세션 상세 참가자 행 UI는 추가하지 않았다.
- 프런트 build에는 기존 CSS 토큰 import와 대형 chunk 경고가 남는다. 백엔드 skipped는 PDF 시스템 라이브러리 관련 11건 및 기존 선택적 테스트 1건이며 기존 deprecation/미await 경고가 남는다.
- 물리 객체 삭제는 정기 큐 처리 지연만큼 접근 차단보다 늦을 수 있다. S3 versioning 사용 시 과거 버전·delete marker·multipart 정리 정책도 운영에 적용해야 한다.
- 수집 EEG 동의 확인과 목적 기록은 별도 연구·제3자 제공 동의 이력 정책을 대체하지 않는다. 이번 P0가 연구 반출 허가를 보장한다고 주장하지 않는다.

## 절차

plan.md / verify.md를 구현 전에 작성하고 코디네이터의 명시 승인을 받은 뒤 구현했다. 기존 `.sdd-counter`와 spec.md는 디스패치 이전 변경이며 보존했다. 독립 리뷰는 코디네이터에게 요청했으나 10분 타임아웃 이후에도 회신이 없어 최종 검토 항목으로 인계한다. 구현 전 Verify 승인은 받은 상태이며, 추가 독립 리뷰를 완료했다고 주장하지 않는다.
