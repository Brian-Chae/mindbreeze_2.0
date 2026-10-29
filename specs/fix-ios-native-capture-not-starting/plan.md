# [Fix] iOS 앱 실행 직후 메모리 초과 종료 + 클래스 화면 '밴드를 연결하는 중' 고착 — 원인분석·계획

## 증상 (대표 실기기, TestFlight dev 빌드 23 = 3155038b)
- 앱이 실행 후 25~31초 만에 강제 종료(4회 반복). 커널: `App exceeded mem limit: ActiveHard 3072 MB (fatal)`.
- 클래스 화면 진입 시 '밴드를 연결하는 중이에요'에서 멈춤, 데이터 없음. 서버엔 `capture_stream` 0건.

## 확정된 사실 (기기 직접 확인, 읽기 전용)
- JetsamEvent: App 프로세스 rpages 814MB → 2051MB → 3073MB(per-process-limit).
- 앱 컨테이너 `Library/Application Support/measurement/active.json` = 세션 `04ab448d…`, state=`CAPTURING`, 시작 10/27 20:21(약 2일 전).
- 그 세션 디렉터리: `feature.journal` 504MB(141,982창), `metric-outbox.journal` 506MB, `raw.journal` 10.9MB. 창은 1초 간격으로 39시간 연속(10/27 20:21~10/29 11:48), 후반 대부분 contact unknown/no_ppg 의 빈 gap 창.
- `gap.journal` 에 `app_killed` 구간이 여러 건 → 이 세션은 앱이 죽을 때마다 `recoverOnLaunch` 로 되살아났다.

## 원인
1. (확정) `MeasurementManager.recoverOnLaunch()` 는 active.json 의 세션 나이를 보지 않는다. 이틀 지난 CAPTURING 세션을 매번 다시 이어받는다.
2. (확정) 이어받을 때 `MeasurementEngine.recover()` 가 `AppendOnlyJournal.scan` 으로 feature(504MB)·outbox(506MB) 전체를 `Data` 로 올리고 레코드마다 payload 를 복사 → 수 GB → 3GB 한도 초과로 jetsam.
3. (확정 경로, 실기기 재현 미확인) 되살아난 낡은 세션이 매니저를 점유(`state=reconnecting`)하므로 새 세션의 `startMeasurement` 는 `alreadyActive` 로 거절 → JS `startForSession` 실패 → 화면 '연결하는 중' 고착, capture.start 미전송. 빌드 21 에서 같은 고착이 있었던 것과 부합(낡은 세션은 그때도 존재).
4. (추정) 39시간 분량 gap 창이 생성된 경위(코어의 큰 시간 공백 처리)는 Rust 코어 영역이라 이번 수정에서 바꾸지 않고, 되살림 한도로 방어한다.

## 수정
- `recoverOnLaunch`: 되살림 거부 규칙 `recoveryVeto` 추가 — (a) raw.journal 마지막 수정이 3시간 초과 = `stale_session`, (b) feature/outbox 저널이 128MB 초과 = `journal_too_large`. 거부 시 active.json 을 `active.abandoned-<ms>.json` 으로 옮기고(증거 보존·삭제 없음) 소유권을 잡지 않는다. 세션 디렉터리는 건드리지 않는다.
- `startMeasurement`: 다른 sessionId 의 수집이 arming/capturing/reconnecting 이면 `superseded` 로 봉인한 뒤 새 세션을 시작한다(낡은 세션이 새 시작을 영구히 막지 않게).
- 진단: 네이티브 시작 실패 사유(`nativeM.code`)를 클래스 화면 기기 시트의 오류줄에 표시(현재는 숨김). 되살림 거부는 os_log 로 남긴다.

## 이번에 하지 않는 것
- 기기의 1GB 저널 삭제(승인 필요, 데이터 삭제). 새 로직이 더는 읽지 않으므로 앱 동작엔 영향 없음.
- Rust 코어 gap 창 상한. 서버 진단 엔드포인트 신설.
- 앞서 가설이던 BLE 재획득·소켓 토큰 형식은 이번 증거에서 원인 아님(소켓 접속 이전에 막힘).
