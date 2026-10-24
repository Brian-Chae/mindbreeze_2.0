# EEG raw ACK 유실 수정 — 구현 전 검증 계획

작성: 2026-10-24. 기준 HEAD: aa3505b5952ff09c8529c9d4b3c86959d7be5280.
사용자 요청의 [Fix] 범위·진행 승인에 따라 이 문서를 구현 전 단독 커밋한다.

## 원인분석

- `frontend/src/hooks/useEegRawUpload.ts:181-184`: HTTP 성공만 확인하고 ACK 본문과 무관하게 로컬 payload 삭제.
- 같은 파일 `:189-195`, `:225-239`: 특정 API 4xx/8회 실패를 dead-letter라고 부르지만 영속 보관 없이 실제 삭제.
- `frontend/src/hooks/useBand.ts:455-472`: enqueue Promise 성공 전에 샘플 버퍼·인덱스 변경. IndexedDB 실패 시 유일한 사본 유실.
- `useBand.ts:452,1163`와 `raw-chunk-queue.ts:124-134`: 재마운트 시 index=0, feature cursor stream 재사용, 동일 키는 기존 payload 반환. 서버 presign도 동일 키를 재사용하므로 로컬 누락 및 서버 덮어쓰기 가능.
- `backend/app/services/eeg_raw_service.py:221-248`: HEAD 실패는 HTTP 200 + failed, 재ACK는 acked=0. 집계 숫자만으로 특정 청크 성공을 증명할 수 없음.
- SDD-244 spec §2 P0 및 research/01-mindbreeze.md G5–G7과 실제 소스를 대조했다. SDD-244 본체 파일은 수정하지 않는다.

## 최소 수정 계획

1. BE ACK 기존 필드 유지 + 청크별 ID/status/checksum/size 결과 추가. commit 후 반환. FE는 자신의 청크 ID와 uploaded 및 메타 일치를 확인한 경우만 삭제. missing/malformed/failed ACK는 보존. 구 서버의 집계-only 응답도 보존하는 fail-closed 방식.
2. 4xx·최대 시도는 payload와 실패 상태를 IndexedDB에 보관. 반복 폭주를 막는 cooldown 후 재시도 가능. 영구 거부 반복(3회)에는 로컬·콘솔 손실/업로드 불가 이벤트를 남기되 payload는 용량 정책 외에는 삭제하지 않음. 동일 인증 소유자에 한해 다음 세션에서 과거 큐 복구를 허용하고 게스트/입장 자격은 원래 세션으로 제한. 자격 증명 자체는 저장하지 않음.
3. 큐 용량 상한(64 MiB) 초과 시 가장 오래된 항목부터 손실 이벤트를 먼저 영속 기록한 뒤 제거. 진단 기록에는 raw/인증 정보 제외. enqueue 트랜잭션 실패 시 기존 payload를 유지.
4. 메모리 버퍼는 영속 enqueue 성공 이후에만 해제. 실패분은 동일 키로 재시도하고 후속 샘플과 분리, 종료/재마운트 경계에서도 프로세스 내 복구 가능. 프로세스 강제 종료 + IndexedDB 불가 시 메모리 보존 한계는 명시.
5. raw 전용 stream 식별자를 mount/수집 인스턴스마다 유일하게 발급하여 feature cursor와 분리. 기존 큐 포맷은 읽기 호환, 충돌 시 서로 다른 payload를 성공으로 반환하지 않음.
6. 수정은 raw hook/큐/버퍼 연결/ACK 스키마·서비스와 관련 테스트에 한정. 마이그레이션 없음. 웹·Capacitor 공통 코드 적용, 앱은 다음 빌드 반영.

## 구현 전 QA 체크리스트 (아직 미실행)

- [ ] ACK 성공/부분 실패/대상 ID 불일치/누락/잘못된 메타/중복 ACK를 구별한다.
- [ ] 네트워크·PUT 서명만료·API 400/403/404/409/413/422·8회 초과에도 payload가 남는다.
- [ ] quarantine은 재시작 및 재마운트 후 cooldown에 따라 복구 가능하다.
- [ ] 과거 세션 재시도는 동일 인증 소유자만 가능하며 다른 계정/entry credential로 전달하지 않는다.
- [ ] 영구 거부 반복 이벤트가 로컬/콘솔에 남고 quota 제거 이벤트와 구별된다.
- [ ] 용량 초과 시 오래된 순서로 제거하며 명시적 손실 이벤트가 남는다.
- [ ] enqueue 실패·동시 샘플 수신·종료·재마운트에서 보존/재시도와 키 비충돌을 확인한다.
- [ ] 새 회귀 테스트 RED를 확인한 후 구현한다. 기존 삭제 기대 테스트는 새 보존 계약으로 바꾼다.
- [ ] 관련 vitest 및 pytest, 전체 FE/BE 스위트, tsc/build를 실행하고 기존 실패를 구분한다.
- [ ] 독립 검증자가 diff/테스트를 리뷰하고 중요 경로를 재검증한다.

## 실행·안전 경계

서버·실DB·.env·메일·배포 접근 없음. 테스트는 로컬 격리 자원만 사용한다. 파일/브랜치 삭제 없음.
실기기·실S3·앱 바이너리 검증은 이번 실행 증거에 포함되지 않는다. 서버 HEAD의 기존 checksum 검증 한계 및 stub 동작은 별도 명시한다.
완료 후 summary.md, `fix(eeg-raw): …` 커밋, 현재 fix 브랜치 push, develop 대상 지정 제목 PR만 생성한다. 머지/develop push/배포 금지.
