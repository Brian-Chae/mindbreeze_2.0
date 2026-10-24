# SDD-238 — 구현 전 검증 체크리스트

- 작성: 2026-10-24, 코드/타이머 변경 전에 커밋한다.
- 진행 승인: Brian의 이번 요청에 따른 Stage ③~⑥ 연속 수행. 실제 삭제·배포 승인은 별도.

## 로컬 검증
- [x] 기존 연구 동의 미ack 보류, ack 원본 삭제, 거부·철회·미동의 90일 삭제 확인(BT58/59 및 기본 원본 삭제).
- [x] 방침 제3조 90일·제5조의2 비식별 연구 사본 무기한 보관과 비교, 원본 영구 보존과의 차이 기록.
- [x] apply_from UTC 하한·미설정 차단·하한 이전 제외 확인.
- [x] timer 기대값 변경 후 RED 확인, enabled=1 변경 후 GREEN 확인.
- [x] renderer timer 19개, retention UTC 03:00/timeout 3600, research_export 비활성 확인.
- [x] install-release 스텁 통합: 신규 timer 설치 및 활성 서버 enable, 비활성 서버 설치만 확인.
- [x] Settings/환경 매니페스트의 실제 삭제 기본 false, 구 eeg_raw_retention_days=0 유지 확인.
- [x] dry-run 후보·연구 보류 집계, 원본·개인정보 보존, 스토리지 삭제/고아 정리/알림 호출 0, 동의 상태 불변 확인. 실행 이력 쓰기는 기존 허용 동작.
- [x] `pytest tests/test_sdd209_b12_retention_sweep.py tests/test_sdd209_b13_research_export.py tests/test_sdd210_deploy_templates.py tests/test_sdd210_install_release.py` 실행.
- [x] 전체 백엔드 pytest 실행. 실패/skip/환경 제약은 수치와 원인을 summary에 기록.
- [x] 독립 리뷰 및 감독의 diff·테스트 재확인, 4종 문서 작성.

PR은 최종 제출 단계에서 생성하고 URL은 최종 응답으로 제공한다.

## 배포 이후 별도 검증 (이번 작업에서 실행하지 않음)
- [ ] 승인받은 dev 배포 및 실제 스케줄러 타이머 등록 확인.
- [ ] dev dry-run 대상 건수·연구 보류 건수·삭제/스크럽 0 보고 확인.
- [ ] 외부 연구 저장소 사본·영구 보관 정책·ack 확인.
- [ ] Brian이 영구 보존 의미·적용 하한·실제 삭제 범위 승인.
- [ ] 승인 이후 별도 운영 작업으로 실제 삭제 활성 및 첫 보고 확인.
