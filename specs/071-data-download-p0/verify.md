# SDD-071 구현 전 검증 계획

작성 시점: 구현 코드 작성 전, 2026-09-16.

- [ ] 담당 상담사와 플랫폼 관리자 생성 성공; 타 상담사/기관 관리자/내담자/비활성 사용자 차단.
- [ ] 작업 생성자 외 상태 및 URL 조회 차단; 호스트 변경·동의 철회 이후 생성/게시/URL 차단.
- [ ] 종료 세션의 명시 participant_id만 처리; 타 세션 참가자 및 타인 feature/report 혼입 없음.
- [ ] 동일 멱등키 재요청은 동일 작업, 옵션/목적/대상 변경은 409; 큐 전달 실패는 failed.
- [ ] 게스트 feature/완료 client 리포트 포함, 참가자 미지정·미완료 리포트는 제외 사유 기록.
- [ ] CSV 정확한 허용 컬럼, NULL 빈 필드, 0 유지, 정밀도·quality·구간 재시작 유지.
- [ ] ZIP 메타데이터 및 리포트에 실명/이메일/생년월일/성별/상담 본문 없음.
- [ ] 파일별 바이트/SHA-256/행수와 manifest 일치, 사전 및 README 포함.
- [ ] EEG 미측정/불명·리포트 누락은 경고와 포함/누락 사유를 구분.
- [ ] S3 미설정/업로드/서명 실패는 명시 실패, 스텁 URL 없음.
- [ ] Celery 중복 실행은 결과 중복 게시 없음; 만료는 URL 차단 및 객체 삭제 재시도 가능.
- [ ] URL TTL은 min(300초, 패키지 잔여시간), 요청/완료/실패/URL 발급/삭제 감사 기록.
- [ ] FE 목적 입력 → 상태 폴링 → 준비 완료/경고 → S3 직접 다운로드; 실패/만료 안내.
- [ ] backend/venv/bin/pytest 및 frontend npm run build 성공.

실제 AWS GET·배포 worker/beat·운영 migration·브라우저 UI는 로컬 단위 테스트/빌드만으로 완료 주장하지 않는다.

## 실행 결과 (구현 후 별도 기록)

자동 검증: 신규 19건 및 전체 483 passed / 12 skipped. 프런트 TypeScript/Vite build, 신규 FE ESLint, diff 공백 검사 통과.
Celery 독립 프로세스 task 등록 및 Alembic 오프라인 SQL 검증도 포함했다.
실제 AWS·배포 PostgreSQL 잠금/마이그레이션·worker/beat 운영·브라우저 저장 검증은 남아 있으며 summary.md에 명시했다.
