# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소

- 상태: Stage ① Spec — 확정(2026-10-31) · 같은 날 대표 지시 2회로 재정렬(1차: 오프라인 클래스·완결성 우선 → **2차: 앱 수정 허용, 목표는 "40명 전원 데이터 빠짐없이 저장" 하나**). Stage ② plan.md · Stage ③ verify.md 동봉.
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

## 2. 목표 (대표 지시 10/31 2차 — 단 하나)

**40명 전원이 뇌파 밴드만 연결돼 있으면, 그 데이터가 빠짐없이 서버에 저장된다.** feature(리포트 입력)→DB 100% 가 1순위, 원시→S3 100% 가 2순위. 리포트는 데이터만 있으면 무조건 나온다는 전제이며, 리포트·회원 자기 화면·코치 실시간 모니터링은 `plan.md` §9 "후속(저장 완결성에 영향 없음)"으로 분리한다. 앱 수정은 허용(재빌드·설치 감수), 구앱 호환은 선호.

구조 원칙: 저장은 실시간 연결 상태(READY/DEGRADED/소켓 유무)와 **무관**해야 한다. feature·원시 모두 **"로컬 영속 → 서버 확인(summary) → 모자란 것 재전송(REST 배치 / 재큐잉)"** 3단계 대조 프로토콜로 종료·재접속·강제종료 뒤에도 수렴한다. 서버는 클라가 이미 올리는 feature archive 를 DB 로 재생하는 안전망을 둔다.

## 3. 범위 / 비범위

- 범위: `plan.md` P0~P4(저장 완결성) 전부 — P1 서버 저장 우선·REST 배치 접수·summary API·저장을 막는 요인 제거 → P2 feature archive→DB 재생·24h 검역 → P3 앱 3단계 대조·이어올림(Android/iOS/웹) → P4 실밴드·소크·go/no-go. 5트랙 병렬(BE/Android/iOS/웹·공통/QA), FE·네이티브 동결 11/2 12:00, 서버 동결 11/2 22:00, 설치 11/3 09:00.
- 후속(삭제 아님, `plan.md` §9): 리포트 결측 표기·재생성, 자기 화면 로컬 우선, publish 틱·pending 투영·백프레셔, 다중 워커, iOS BGProcessingTask, 보관 정책 표시.
- 비범위: metrics outbox 탈출, 대형 객체 multipart, 임의 기기 간 원본 이전, 셀룰러·배터리 세부 정책.

## 4. 제약

- 앱 웹 번들은 내장(`frontend/capacitor.config.ts` `webDir: 'dist'`, `server.url` 없음) → 프런트 변경도 앱 재빌드·재설치가 필요하다. 네이티브 측정 경로(`measurement-path.ts`: 앱이면 항상 `native`)가 현장 기본이므로 트랙 1 필수는 네이티브 코드 기준이다.
- 모든 서버 변경은 env 플래그로 즉시 롤백 가능해야 한다. 마이그레이션은 P2 재생 상태 컬럼 1개(후속 P5 pending 테이블은 별도).
- 구현자 ≠ 검증자. verify.md 는 구현 전에 확정하고 사후 수정하지 않는다. 실밴드 시험은 구현 후 수행(대표 결정).
- 서버 변경은 즉시 적용, 앱 변경은 사용자 업데이트 필요 → 서버 API 는 additive(구앱 호환은 **선호**), 앱 변경은 동결·빌드·설치 소요를 일정에 반영한다.

## 5. QA 리스트 (= 수락 기준, 상세는 verify.md) — 합격선은 "저장 완결성" 하나

| # | 등급 | 항목 | 기준 |
|---|---|---|---|
| Q1 | A | 저장 연결 독립(소켓) | DEGRADED·RESYNCING 중 `live:metric` 이 `accepted durable:true`. `not_ready` 는 join 전에만. 저장 판정(fencing·동의·cutoff) 불변 (V-A1~A4) |
| Q2 | A | 저장 연결 독립(REST) | 소켓 없이 `POST /live-features/batch` 로 같은 envelope 저장, historical 판정(lease·offline_bound 미적용, 동의·cutoff 적용), live 투영 0 (V-A9, V-A11) |
| Q3 | A | 서버 확인 API | feature summary `missing_ranges` 가 DB 와 일치, 원시 summary `receipt_hash` 일치 (V-A8, V-S15) |
| Q4 | A | **3단계 대조 종단** | 40기기 혼합(네트워크 단절·강제종료·종료 시 Wi-Fi 끊김)에서 20분 안에 feature 600/600·원시 100%·S3 전수 대조·pending 0 (V-A10) |
| Q5 | A | dev 착용 40 부하 | `not_ready` 0 · 거절 0 · Traceback 0 · 40×600/600 · 중복 0 · ≥40창/s · Redis 60초 정지 중 저장 지속 (V-L2, V-L11) |
| Q6 | A | 원시 완결 | 청크 100% `uploaded`, 갭 0, **S3 size/sha256 전수 대조 100%** (V-L4) |
| Q7 | A | feature archive→DB 재생 | 거절·폐기 창이 서버 재생으로 600/600, 10/31 시연 세션 소급 리허설 (V-S16, V-A5~A7) |
| Q8 | A | 이어올림·복귀 | 강제 종료 → 다른 화면 재실행 → 전 scope 자동 업로드; 포그라운드 복귀 시 renew·flush·drain (V-C5, V-C9) |
| Q9 | A | 격리 정책 | 시간검토 류 거절은 historical 재시도로 수락, 동의 철회·hash 충돌만 최종 격리 (V-A12) |
| Q10 | A | 웹 outbox 영속 | 300 폐기 0, IndexedDB 복원 → 600/600 (V-A13) |
| Q11 | A | DEGRADED 복귀·저장을 막는 요인 | heartbeat 성공 1회에 READY, 스레드풀·DB 풀·NOWAIT·슬롯 회귀 0 (V-S5~S8, V-S14) |
| Q12 | A | 실밴드 11종(구현 후) | verify.md §D (iOS·Android 후보 빌드 각 1대 이상) |
| Q13 | A(선호) | 구앱 호환 | vc31/iOS31 기존 동작 유지 + A1·A6 수혜 (V-D6) |
| Q14 | 후속 | 리포트·자기 화면·호스트 지연·pending 투영 | V-R*, V-M*, V-S9~S12, V-L5·L9 — 기록만, 판정 제외 |
