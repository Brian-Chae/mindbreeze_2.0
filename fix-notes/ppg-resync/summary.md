# Android PPG 시간축 재동기화 폭주 — Summary

## 원인
- `TimestampSynchronizer.ts` 가 EEG·PPG·ACC 3센서 공유 `lastDeviceTime` 과 벽시계(`metrics.masterTime`)를 섞어 driftRate 를 산정 → BLE 도착 지터만으로 5ms/s 초과 → 5초 주기와 무관하게 매 패킷 `performResync`(masterTimeBase 재앵커링) → 샘플 시각 역행·점프.
- 재현(3센서 혼합, 지터 ±25ms, 150초, 수정 전): 재동기화 188회, PPG 시각 역행 40, EEG 역행 79, 간격 오차 최대 48ms.

## 수정
- `TimestampSynchronizer.ts`: 장치 카운터 고정 매핑 + 완만한 보정(slew). 5초 주기에만 구간 최소 오프셋으로 장기 드리프트 추정, 1회 최대 2ms 이동(EEG 간격 4ms 미만 → 단조 보장), 1초 초과 이탈은 하드 재앵커링. driftHistory/trackDrift 제거, ACC 정상 스냅 로그 억제.
- `host-live-model.ts`/`HostLiveContainer.tsx`: `holdLastValues` — band=on 참가자의 지표가 일시 null 이면 직전 값 15초 유지.

## 테스트
- `tests/fix-ppg-resync.test.ts`(RED→GREEN): 수정 후 재동기화 0회(150초, 5초 주기 상한 30), 시각 역행 0, 간격 오차 ≤2.0ms(지터 25ms)/0.1ms 미만(지터 0).
- `tests/fix-host-hold-last.test.ts` 5건.
- 전체 vitest: 17건/8파일 실패(기존 기준선과 동일, 신규 실패 0), 3105 통과. tsc·eslint 통과, build 통과.

## 2차 수정 — 실기기 내부 상태 실측 반영
- 실측: rrIntervalBuffer 길이 1([1920]) 고정, lastRrEndTimestamp가 현재보다 +92,400초(25.7h) 미래, 패킷 수 명목의 약 2.2~2.5배.
- 원인 ①(확정, 코드): `TimestampSynchronizer`가 EEG·PPG·ACC 3센서에 매핑(masterTimeBase/deviceTimeBase) 하나를 공유 — 센서별 장치 카운터 원점이 다르면 첫 센서에 앵커링된 매핑으로 다른 센서 시각이 수십 시간 어긋남(재현: PPG 원점 +92,400s → PPG 시각이 현재보다 +92,255초). 이 미래 시각이 `AnalysisMetricsService.updateRRIntervalBuffer`의 `lastRrEndTimestamp`를 앞으로 밀어, 이후 정상 시각 박동이 전부 `ts > lastRrEndTimestamp` 중복 제거에서 폐기 → RR 버퍼 1건·SDNN/호흡 null. `RR_CLOCK_RESET_MS` 리셋은 과거 방향만 처리했다.
- 원인 ②(코드 추정, 기기 미확인): Native는 `@capacitor-community/bluetooth-le`가 내부적으로 `eventListeners` 키 단위로 중복 방지(startNotifications 시 이전 리스너 remove)하지만, 네이티브 측 구독이 이전 연결에서 남은 경우 같은 패킷이 2회 오는 것은 코드만으로 확정하지 못했다. 중복 알림이 오면 `parsePPGPacket`이 샘플을 2배로 만들어 RR 간격이 과대 계산(`PPGSignalProcessor.ts:242`)된다. 어느 쪽이든 아래 방어로 차단한다.
- 수정:
  - `TimestampSynchronizer`: 센서(EEG/PPG/ACC)별 독립 시계. 패킷 헤더 시각이 직전 이하이고 2초 이내면 중복 패킷으로 판정(`isDuplicatePacket`), `blePacketParser`의 EEG·PPG·ACC 파서가 중복 패킷을 샘플 0개로 반환 → raw 저장 이전의 분석 경로(EEG 지표 포함)에서 중복 제외. 재연결(`bluetoothService` 상태 초기화)에서 `timestampSync.reset()`.
  - `AnalysisMetricsService.updateRRIntervalBuffer`: 현재+5초보다 미래인 RR 시각은 거부, 이미 미래로 밀린 커서·버퍼는 리셋.
  - `capacitor-ble-adapter.startNotifications`: 등록 전 `stopNotifications`를 항상 시도해 네이티브 구독 단일화(Web의 EEG-BLE-001과 동등).
- 주의: raw 원문 저장(`captureRawPacket`)은 파서 앞에서 호출되므로 중복 패킷 원문은 그대로 저장된다(원문 보존 정책, 분석만 중복 제거). 필요하면 후속으로 raw 저장 쪽 중복 제거를 검토.
- 테스트 `tests/fix-ppg-dup-future.test.ts`: RED(수정 전) 2건 실패 — 중복 시 샘플 15008(명목 7500)·원점 차이 시 PPG 시각 +92,255초 / 미래 시각 주입 회복 1건은 수정 전 실패(후 통과). GREEN 3/3: 샘플 7504, 90초 SDNN 301.95·호흡 13.1, 시각 현재 근처. 중복 판정 2초 창으로 `sdd244-capture` 기존 테스트 1건 격리(싱글턴 reset) 보정.
- 전체 vitest 17건/8파일 실패(기준선 동일), 3108 통과. tsc·eslint·build 통과.

## 한계·후속
- 합성 신호에서는 수정 전에도 SDNN(60초)·호흡(90초)이 산출됨 → 재동기화 폭주가 실기기 미계산의 단독 원인이라는 증거는 확보하지 못했다. 시각 역행에 따른 RR 버퍼 리셋 위험을 제거하는 정합 수정이며, 실기기 재측정으로 확인해야 한다.
- 패킷 2.2~2.5배의 정확한 발생원(리스너 중복 vs 네이티브 중복 구독)은 기기 재측정으로 확정 필요. 방어는 적용됨.
- EEG 지표/raw 저장 시각: 간격 4ms 유지 확인(테스트). HARU BAND 스코어링(eeg_metrics) 미변경.
- PR#111(fix/resp-hrv-display) 커밋 2건 포함.

## 2차 실기기 측정(10/25 22:20 KST, 세션 260273e0·1a3f8dc7) 후속

### (2) biosignal-artifacts/presign 422 · feature 저장 실패
- 확정 근거: 서버 로그(경로만) — 422 는 전부 `biosignal-artifacts/presign`, 세션당 3~5건·약 40초 간격(= 4초 pump 재시도 아님, 묶음 단위 1건씩 dead-letter). 422 본문 필드는 서버 로그에 없었음(`main.py` 핸들러가 경로만 기록) → 위반 필드 경로·사유를 남기도록 로그 보강(값은 미기록).
- 코드상 서버가 422 를 내는 조건(`schemas/biosignal.py` ArtifactPresignChunk·TimeRange, `biosignal_artifact_service._validate_scope`) 중 클라이언트가 실제로 어길 수 있는 2가지를 재현·수정:
  1. **묶음 크기 상한 없음** — `feature-collector.ts` `run()`은 10초/800KB '하한'만 있고 상한이 없다. 업로드 pump 가 밀려 emit 이 쌓이면 한 묶음이 서버 `size_bytes ≤ 1 MiB` 를 넘어 422. → `BUNDLE_HARD_BYTES=900_000` 초과 시 반으로 분할(`splitBundle`). 합성 테스트에서 150건 누적 시 1.78MB 단일 묶음 재현 → 분할 후 전부 상한 이내, 150건 모두 보존.
  2. **time_range 역전** — `bundle()`이 `records[0]` 시작 ~ 마지막 레코드 끝으로 계산해, 분석 완료 순서가 창 순서와 뒤바뀌면 from > to → 서버 `TimeRange.ordered` 422. → `timeRangeOf()`(최소 from·최대 to). 이미 보관된(dead-letter) 역전 메타는 `normalizeArtifactMeta()`로 presign 직전 교정(checksum 은 payload 기준이라 불변)해 '전송 재개' 시 복구된다.
- **한계(정직)**: 위 2건이 이번 9건의 실제 위반 필드라는 것을 서버 422 본문으로 직접 확인하지는 못했다(보안 정책상 DB·.env 미접근, 로그에 필드 없음). 합성(EEG·PPG·ACC, 재앵커 포함)에서는 EEG 단독 정상 흐름에서 위반이 재현되지 않았고, 상한 초과·역전만 재현됐다. 다음 실기기 측정에서 보강된 로그(`요청 검증 실패 (chunks.0.size_bytes: less_than_equal …)`)로 확정 가능.
- **feature 저장 실패 4회**: 모두 `POST /sessions/{id}/end` 직후 1초 간격 3건(퇴장 직전). `session_live_namespace._store_feature` → `resolve_upload_participant`(allow_completed 기본 False) → 종료된 회차의 WS feature 를 `member_access_revoked` 403 으로 거부. 종료 후 마지막 1~3초분 WS feature 는 REST 폴백(`ingest_features`, 같은 가드)도 동일 거부. 로그에 `exc_info` 추가. 이 3초분 1Hz feature 는 서버 DB 에 없지만 **raw/feature artifact(biosignal) 경로는 allow_completed=True 라 종료 후에도 업로드 가능** → 완결성은 artifact 쪽이 보장(아래).

### (1) 상담사 집중·이완 '-'
- 필드명 일치: 회원 `metricsToFeature`(useBand.ts:295)의 `focus_index/relaxation_index/emotional_stability` ↔ WS `eeg_feature.feature.*` ↔ 상담사 `ClassPlayerPage.tsx:420` 읽기 ↔ DB `relaxation_index` → live-metrics `current_efficiency`. 이름 불일치 없음.
- 이 브랜치의 `holdLastValues`·`formatBodyMetric`은 값을 만들거나 지우지 않는다(null 이면 직전 값 15초 유지만, 호흡·HRV 표시문구만 변경) → 집중·이완을 '-'로 만들지 않음(`fix-host-hold-last.test.ts`).
- 진짜 위험 지점: 상담사 집중·정서는 WS `extra.at` 가 10초(`EXTRA_FRESH_MS`) 이내여야 표시되는데 `at` 을 `last_eeg_at`(서버 브로드캐스트에 없음) 폴백으로 **회원 기기 시계 `feature.timestamp`** 에서 가져왔다. 기기·상담사 시계가 10초 이상 어긋나면 집중·정서 '-' (이완은 4초 폴링 행값이라 영향 적음). → 수신 시각(`Date.now()`)을 쓰도록 수정(ClassPlayerPage.tsx:424).
- **한계**: dev 가 develop 51621fc7(미배포 브랜치 아님)이라 dev 의 '-' 가 이 시계 문제인지 이완까지 '-'인 별도 원인(밴드 상태 `ok` 아님 → `valid` false 등)인지는 실기기 재측정 없이 단정 불가. 이완·집중이 둘 다 '-'면 `valid`(band_connected·device_status==='ok'·EEG 신선도) 실패 쪽이 유력 → 다음 측정 때 live-metrics 행의 `device_status`·`last_eeg_at` 확인 필요.

### (3) '전송 대기 376건 · 전송 확인 8건'
- '전송 확인'은 `queue.counts().blocked` = dead_letter 건수. `upload-queue.ts:52` 가 422 를 영구 실패(permanent)로 분류하므로 **위 422(약 9건 ≈ 8~9건)와 같은 건**일 가능성이 매우 높다(15분 로그 422 9회 / 화면 8건).
- 376건 대기는 정상 지연(수집량 > 업로드 처리량): 15분 presign 1510건 ≈ 1.7건/초, UPLOAD_CONCURRENCY=4·pump 4초·1라운드 24건. 수업 종료 후 0 수렴은 이번 측정으로 확인하지 못함(필요: 종료 후 큐 카운트 로그).
- 표시 정책(SDD-244 spec.md:77 — blocked/dead_letter 는 사유·명시 재개 노출, 삭제 금지)에 맞춰 변경: 정상 백로그는 숫자 없이 '기록 저장 중'(작게), 보관 건은 '전송 확인 필요 N건' 앰버 배지 + '전송 재개' 버튼. **UX 제안(결정 필요)**: 종료 후에도 N건이 남을 때 안내 문구/자동 재개 여부.

### 데이터 완결성
- 유실 확정: 없음(IndexedDB 큐는 dead-letter 도 payload 보존, 삭제 안 함). 단 현재 dev 앱 빌드에서 422 난 feature/raw_derived 묶음 약 9건은 서버에 아직 없음(회원 기기 큐에 보관 중). 수정 빌드로 '전송 재개' 시 time_range 역전분은 교정되어 올라가지만, **크기 초과로 거부된 묶음은 재개해도 같은 422**(이미 만들어진 payload 라 분할 불가) → 이 경우 원 raw 청크(biosignal-raw, 전부 ack)에서 feature 재생성 필요. raw(EEG·PPG·ACC)는 presign=ack 로 완전 수신(939/938, 526/526의 1건 차이는 15분 경계 진행 중).
- 서버 feature 저장 실패 3~4건(종료 직후 1Hz 마지막 3초)은 REST 5초 폴백도 같은 가드로 거부 → 1Hz DB 에는 없음, biosignal artifact 에는 존재.
