# [FIX] 생체신호 전송 대기 누적·튕김·호흡/HRV 미표시 — summary

## 원인 (파일:줄은 수정 전 develop dfb0868a 기준)
| # | 증상 | 원인 |
|---|---|---|
| 1 | presign 남발(artifacts 1667·raw 1019, ack 0건) | `useBiosignalCapture.ts:111` pump 재진입 가드 없음 + 4초 타이머/online/close 가 겹쳐 같은 객체를 동시 presign. `upload-queue.ts:37` 동시성 2·1건씩 presign→PUT→ack 직렬 |
| 2 | ack 0건 = PUT 전량 실패 | Android 앱 오리진 `https://localhost` 가 S3 버킷 CORS 에 없음(OPTIONS 403 직접 확인: localhost·capacitor://localhost 거절, dev 웹 오리진만 허용). `eeg-raw.ts:125` 가 WebView fetch 로 PUT |
| 3 | 대기 1255건 → 튕김 | `useBiosignalCapture.ts:105` refresh 와 `upload-queue.ts:39` 가 매번 `objects()`(전 payload getAll). 적체될수록 수백 MB 를 4초마다 읽어 WebView 메모리·메인스레드 한계 → 앱 종료 |
| 4 | '다른 창이 기록 중' | `durable-queue.ts:89` 가 lease 만료(10s)만으로 lease_lost. 메인스레드가 멈췄다 돌아오면 같은 창이 스스로 권한을 잃음. 재입장은 이전 lease 가 TTL 안에 남아 `lease_held` → `useBiosignalCapture.ts` 가 재시도 없이 영구 stopped. 앱 종료 시 release 없음 |
| 5 | raw 미저장·eeg-raw 403 160회 | 403 은 07:35:20 `/end` 직후부터. 종료로 회원 상태가 completed 가 되면 `session_service.py:2617 require_eligible(allow_completed=False)` 가 `member_access_revoked` 403 → v1/v2 사후 업로드 전량 거부 → 클라 permanent dead_letter(`useEegRawUpload.ts:230`) |
| 6 | 데이터센터/ZIP 에 raw 없음 | 조회 조건은 `EEGRawChunk.upload_status='uploaded'`(biosignal_export_adapter.py:102). 위 1~5 로 PUT·ack 가 한 건도 성공하지 못해 uploaded 행이 없음. 조회 조건 자체는 저장 경로와 일치(수정 불필요) |
| 7 | 상담사 HRV '-' | live-metrics 응답/스키마에 `sdnn` 필드 없음(rmssd 만). 호스트 화면은 `row.sdnn` 을 읽음(`host-live-model.ts:60`) → 항상 null. WS 패치(`apply-eeg-feature.ts`)도 sdnn 미반영 |
| 8 | 회원 호흡/HRV '-' | RR 버퍼가 비는 경로: `AnalysisMetricsService.updateRRIntervalBuffer` 가 박동 시각 하나라도 NaN 이면 `Number.isFinite` 필터로 전 박동 폐기. 정상 시각 신호에서는 합성 PPG 재현으로 SDNN 1.1s·호흡 63s 에 계산됨(60s 게이트, 의도된 값). 즉 시작 후 약 60초는 정상적으로 null 이고 그 사이 '-' 였음 |

409 의 의미: `biosignal_artifact_service.py:106~` 는 같은 슬롯·alias 에 **다른 checksum** 이 있을 때만 409(`artifact_conflict`/`alias_conflict`). 같은 내용 재요청은 200(`upload_url=null`). 따라서 409 를 '이미 저장'으로 간주하면 데이터가 유실될 수 있어 성공 처리하지 않고, 영구 재시도도 하지 않고 보관(dead_letter, '전송 확인 필요')한다 — 기존 동작이 이미 permanent 처리였음을 확인.

## 수정
- 백엔드: 종료 후 사후 업로드 허용 `session_service.resolve_upload_participant(allow_completed)`; v1 eeg-raw·v2 biosignal presign/ack 가 사용. live-metrics 에 `sdnn` 추가(스키마·서비스).
- 프론트 업로드: pump 재진입 가드, 한 pump 최대 8라운드 연속 전송, 동시성 4·배치 24건(payload 는 배치만 로드), 메타 인덱스(`counts/objectsMeta/dueBatch`)로 카운트·close 계산에서 payload 로드 제거, 네이티브 앱 S3 PUT 을 `CapacitorHttp` 로(CORS 우회, 서명 헤더 유지).
- lease: TTL 30s, 같은 창은 만료돼도 소유 유지(다른 창이 가져가지 않은 경우), 재입장은 `lease_held` 를 3s×14회 재시도해 TTL 내 자동 인계, `pagehide` 에서 release.
- 호흡·HRV: 시각 NaN 이어도 RR 누적, 상담사 WS 패치·API 에 sdnn, 값 없을 때 '측정 중' 문구(점수·판정 표시 없음).
- LINK BAND 미착용: `connected` 가드·armed 로직 변경 없음(미착용 시 구독·capability 요청 없음 그대로).

## 테스트
- 신규 `frontend/tests/fix-class-upload-queue.test.ts` 8건: 수정 전 6 실패(RED) → 수정 후 8 통과.
- 신규 `backend/tests/test_fix_upload_after_end.py` 2건: 수정 전 2 실패 → 통과(종료 회원 presign→ack uploaded, live-metrics sdnn).
- 갱신한 기존 테스트 3건(TTL 30s·'측정 중' 문구 반영).
- 전체 vitest: 실패 17건·8파일(기준선 동일), 통과 3071. tsc·eslint·build 통과.
- pytest 관련(sdd244·eeg_raw·sdd027·live_metric·sdd026·class_attendance) 230건: 4건 실패는 develop 기준선도 동일(로컬 venv 에 jsonschema 없음, 변경 무관).

## 한계·미확인
- S3 버킷 CORS 에 앱 오리진(`https://localhost`, `capacitor://localhost`)은 추가하지 않음(S3 직접 조작 금지). 네이티브 PUT 이 CapacitorHttp 로 우회하지만 실기기 검증 필요. 안정적 장기 대책으로 dev 버킷 CORS 에 두 오리진을 추가하는 것을 권장(별도 승인 필요).
- 10/24~25 에 이미 유실·dead_letter 된 raw: 서버에 없는 데이터는 복구 대상 아님(밴드는 자체 저장소 없음). 단, 해당 기기의 IndexedDB 에 남은 사본은 앱 재입장 시 새 코드로 이어서 전송됨(종료 후 403 해소로).
- dev DB·S3 는 조회하지 않음. 호흡 60초 게이트(`RESPIRATORY_MIN_WINDOW_MS`)는 의도된 값이라 유지.

## 실기기 확인 절차
1. dev 배포 후 Android 앱에서 클래스 입장+LINK BAND 연결, 5분 유지: 상단 '전송 대기 N건' 이 0~수십 건에서 오르내리고 계속 늘지 않는지.
2. 60~90초 후 회원 호흡·HRV 가 숫자로 바뀌고 그 전에는 '측정 중' 인지. 상담사 화면도 동일.
3. 앱을 강제 종료 후 즉시 재입장 시 '다른 창이 기록 중' 이 뜨지 않거나 30초 내 사라지는지.
4. 클래스 종료 직후에도 대기 건수가 줄어 0 이 되는지(서버 로그 eeg-raw/presign 403 없음, biosignal-raw/ack 200 존재).
5. 데이터 센터 → 해당 세션 raw 목록과 내보내기 ZIP 에 EEG/PPG/ACC raw 포함.
