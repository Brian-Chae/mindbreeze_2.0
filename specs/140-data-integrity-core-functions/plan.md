# SDD-140 — 구현 계획

7건을 3개 그룹으로 병렬 구현.

| 그룹 | 건 | 방식 |
|---|---|---|
| A. 핵심 기능 정확성 | STT-01, EEG-01 | 누락 청크 건너뛰기 + 실제 길이 offset · 롤업 버킷 play_group_id 분리 |
| B. 데이터 무결성 | DATA-01, STATE-01 | Report 부분 유일 인덱스 + IntegrityError 흡수 · state_version +1 정상화 |
| C. 트랜잭션·권한 | DATA-03, AUTHZ-01, AUTHZ-03 | commit 요청 단위 1회 통일 · 온보딩 완료 분리 · org_admin 가드 |

## 건별 설계

1. **STT-01** — `stt_task.py`: 존재하는 청크만 전사(누락은 `[청크 누락 N개]` 표기), Gemini offset 은 실제 배치 청크 수 기반 누적.
2. **EEG-01** — `eeg_rollup_service.py`/`report_narrative.py`: 버킷 키 `(play_group_id, window_index//resolution)` 분리, 세그먼트별 시간축.
3. **DATA-01** — `record.py` Report 부분 유일 인덱스 2개 + `report_service.py` IntegrityError 흡수·재사용 + alembic `e036a0000029`.
4. **STATE-01** — `session_service.py`: 인메모리 선반영 제거, 원본 스냅샷 +1.
5. **DATA-03** — `auth.py`/`onboarding_service.py`/`client_service.py`: 서비스는 flush, commit 은 요청 1회.
6. **AUTHZ-01** — `auth.py` PATCH /users/me 에서 complete_onboarding 호출 제거 → 전용 엔드포인트로 분리.
7. **AUTHZ-03** — `org.py`/`org_service.py`: change_counselor 위임(마지막 org_admin 가드 + VerificationAudit) + OrganizationCounselorPatch 스키마.

## 검증

- 백엔드 `pytest -q` → 1009 passed / 0 failed
- alembic `upgrade head` 로 인덱스 적용(배포 파이프라인이 실행)
