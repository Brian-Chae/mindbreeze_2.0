# SDD-300 — iOS 저장 진행 이벤트 주기 송출 (진단 "확인 전" 해소)

## 문제
- iOS 기기 시트 연결 진단의 "분석 데이터"/"측정 기록 파일" 줄이 영구히 "확인 전".
- 원인: iOS 는 `SessionSync.onProgress`(변화 시)로만 `feature.counts`/`archive.counts`/`reconcile.state` 를 보낸다
  (`MeasurementHost.swift:140`). SessionSync 가 아직 없거나(자격·업로더 준비 전) 변화가 없으면 이벤트 0건 → JS 스토어가 비어 있다.
- Android 는 `MeasurementPlugin.emitSync`(SyncEventGate)로 변경 즉시 / 2초 주기로 항상 송출한다.

## 목표
- iOS 도 Android 와 같은 계약: 이벤트명·payload 키·순서(feature.counts → archive.counts → reconcile.state) 동일, 측정 중 2초 주기 송출.
- 값 출처: SessionSync 최신 스냅샷이 있으면 그것, 없으면 manager 의 outbox/archive 카운트(0 도 숫자로). null 금지.
- SessionSync 없으면 reconcile.state = feature "idle", raw "idle", complete false.

## 범위 밖
- JS(SDD-297 대체 원천), 인계/해제 로직(293/298).
