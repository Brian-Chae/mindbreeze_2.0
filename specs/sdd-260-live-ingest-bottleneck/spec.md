# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소

- 상태: Stage ① Spec — 확정(2026-10-31) · 같은 날 대표 지시 3회로 재정렬(1차 오프라인 클래스·완결성 우선 → 2차 앱 수정 허용·저장 단일 목표 → **3차 설치자 0명, 구앱 호환 제약 폐기, 서버·앱·웹을 함께 바꿔 가장 단순·확실한 설계로**). Stage ② plan.md · Stage ③ verify.md 동봉.
- 브랜치: `sdd/260-live-ingest-bottleneck`
- 작성일: 2026-10-31 · 기한: 2026-11-04(수) 대구교육청 현장 40명 클래스
- 설계 근거 문서(수정 금지, 근거 보존): `plan-fable.md`, `plan-astra.md`. 통합 확정안은 `plan.md`.

## 1. 배경 (실측)

| 조건 (dev) | 처리량 | 목표 대비 | 특이 |
|---|---|---|---|
| 2vCPU · 착용 30 | 16.5창/s | 55% | metric P95 4.3s, renew 타임아웃 56 |
| 4vCPU · 착용 30 (B) | 20.3창/s | 68% | presign 429 `archive_busy` 24건 |
| 4vCPU · 착용 40 (C) | 18.5창/s | 46% | `not_ready` 559 + 타임아웃 34, 2명 300/341창, Traceback 12건 전부 `live_session_epoch` 락 타임아웃 |

- 출처: `~/.hermes/share/loadtest-40/report.md`, `report-rerun.md`. 서버 전체 CPU 30%인데 uvicorn 프로세스 1개가 110~120% → 병목은 CPU 총량이 아니라 단일 프로세스·회차 1행 락·8스레드 풀의 직렬화.
- 운영 사건: 10/31 시연 세션에서 소켓 종료 후 재연결·측정 재개 없음 → 특징창 3분치만 저장(`~/.hermes/share/band-analysis/report.md`).
- 밴드는 자체 저장이 없다. 폰 로컬이 유일한 사본이므로 "이미 수집·영속된 데이터를 잃지 않는 것"이 1순위다.

## 2. 목표 (대표 지시 10/31 3차 — 단 하나)

**11/4 현장 40명 전원의 feature(리포트 입력)와 원시 데이터를 100% 서버에 저장한다.** 저장 경로는 실시간 연결(소켓 READY·방송·투영)과 완전히 분리한다. 호환 때문에 우회한 설계는 제거한다. 리포트·자기 화면·코치 모니터링은 `plan.md` §9 후속.

새 프로토콜(`plan.md` §1): feature 는 **앱 로컬 영속(journal·outbox) → 5초마다 REST 배치 `POST /features/batch` 가 유일한 DB 기록 경로 → 종료 후 `GET /features/summary` 로 서버 확인 → 모자란 창만 재전송**. 소켓 `live:metric` 은 방송 전용(저장 없음). 서버 저장 판정은 참가자·stream 소유·동의 철회 3가지뿐(lease·offline_bound·24h·시간검토 삭제, 늦게 와도 `late=true` 로 저장). 원시는 기존 archive 큐·presign/ack 에 24h 409 삭제·전 scope 이어올림·종료 후 summary 대조를 더한다.

## 3. 범위 / 비범위

- 범위: `plan.md` P0~P3 — P1 서버(S1 REST 배치 저장·S2 summary·S3 소켓 방송 전용화·S4 시간검토 삭제·S5 자원·S6 마이그레이션) → P2 앱(Android/iOS N1~N6, 웹 W1·W2·UI) → P3 실밴드·소크·go/no-go. 5트랙 병렬(BE/Android/iOS/웹·공통/QA), FE·네이티브 동결 11/2 12:00 → 사이트 APK·TestFlight 교체 → 11/3 설치·검증. 앱은 **신규 설치 1회**(업데이트·구버전 지원 없음).
- 후속(`plan.md` §9, 삭제 아님): DEGRADED 복귀, NOWAIT·publish 틱·pending 투영·백프레셔, 다중 워커, feature archive 재생, 리포트 결측 표기·재생성, 자기 화면 로컬 우선, iOS BGProcessingTask, 보관 정책 표시.
- 비범위: metrics outbox 탈출, 대형 객체 multipart, 임의 기기 간 원본 이전.

## 4. 제약

- 앱 웹 번들은 내장(`frontend/capacitor.config.ts` `webDir: 'dist'`, `server.url` 없음) → 프런트 변경도 앱 재빌드·재설치가 필요하다. 네이티브 측정 경로(`measurement-path.ts`: 앱이면 항상 `native`)가 현장 기본이므로 트랙 1 필수는 네이티브 코드 기준이다.
- 롤백은 직전 릴리즈 재배포 + 마이그레이션 downgrade 1단계(단일 경로라 플래그 없음). 마이그레이션은 `eeg_feature_windows.late/ingest_path` 1개.
- 구현자 ≠ 검증자. verify.md 는 구현 전에 확정하고 사후 수정하지 않는다. 실밴드 시험은 구현 후 수행(대표 결정).
- 현재 앱 설치자 0명 → 구앱 호환 제약 없음. 와이어·엔드포인트·스키마 변경 자유. 앱 변경은 동결·빌드·사이트/TestFlight 교체·현장 설치 안내를 일정에 반영한다.

## 5. QA 리스트 (= 수락 기준, 상세는 verify.md) — 합격선은 "저장 100%" 하나

| # | 등급 | 항목 | 기준 |
|---|---|---|---|
| Q1 | A | REST 정본 저장 | 소켓 없이 `POST /features/batch` 로 저장, `device_timestamp_ms`·`ingest_path='rest'` (V-A1) |
| Q2 | A | 소켓은 저장하지 않음 | `live:metric` 수신 후 DB 행 0, 방송 1 (V-A2) |
| Q3 | A | 저장 판정 4종뿐 | `participant_mismatch`·`stream_not_owned`·`consent_withdrawn`·`hash_conflict` 외 거절 없음, 48h 뒤 창도 `late=true` 저장 (V-A3, V-A4) |
| Q4 | A | summary | `missing_ranges` 가 DB 와 일치, 600창 < 200ms, 타인 403 (V-A8, V-S15) |
| Q5 | A | **3단계 대조 종단** | 40기기 혼합(단절·강제종료·종료 시 Wi-Fi 끊김)에서 20분 안에 feature 600/600·원시 100%·S3 전수·summary 빈 배열 (V-A10, V-L12) |
| Q6 | A | dev 착용 40 부하 | REST `rejected` 0 · 40×600/600 · 중복 0 · Redis 60초 정지 중 저장 지속 (V-L2, V-L11) |
| Q7 | A | 원시 100% | 청크 100% `uploaded`, 갭 0, S3 size/sha256 전수 100%, 24h 뒤도 저장 (V-L4, V-S17) |
| Q8 | A | 이어올림·복귀 | 강제 종료 → 다른 화면 재실행 → 전 scope 자동 업로드; 포그라운드 복귀 시 즉시 재개 (V-C5, V-C9) |
| Q9 | A | 격리 정책 | 동의 철회만 격리, 나머지 무한 재시도, 소켓 ACK 로 acked 0 (V-A12) |
| Q10 | A | 웹 outbox 영속 | 폐기 0, IndexedDB 복원 → 600/600 (V-A13) |
| Q11 | A | 자원 | DB 활성 < 30, anyio 토큰 고갈 0, 슬롯 429 전량 재시도 (V-S14, V-L6) |
| Q12 | A | 실밴드 10종(구현 후) | verify.md §D (iOS·Android 후보 빌드 각 ≥2대) |
| Q13 | A | 구 v1 feature 엔드포인트 제거 | 404, 프런트 참조 0 (V-D9) |
| Q14 | 후속 | 리포트·자기 화면·호스트 지연·투영·다중 워커 | 기록만 |
