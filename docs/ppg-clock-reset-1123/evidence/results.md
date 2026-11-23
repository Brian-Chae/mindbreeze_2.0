# 근거 요약 (읽기 전용 조회 결과 · 개인정보 없음)

## A. dev 0d05175e P05(LXB-017200F1) PPG raw 4,392패킷(28샘플/패킷, 172B) — tick 해석 비교 (dev_raw6.py)
| 해석 | 결과 |
|---|---|
| 리틀엔디언(펌웨어·Rust 코어·SDK 정본) | 4,391/4,391 전진, tick 증가 ≈ 도착시각 증가(±300ms) — 이상 0 |
| 빅엔디언(앱 raw-capture.ts 가 PPG 에만 적용) | 되감김 2,393 + 불일치 1,998 — 거의 전 패킷이 "역행" |
| 전체 구간 | LE tick 13,435,901 → 94,478,793 = 2,473.23s / 도착 2,473.36s (오차 0.13s) |
- 첫 패킷 hex `fd03cd00 08fbaa04c31a…` : LE=13,435,901(정상) / BE=4,244,884,736(헤더 바이트 순서 뒤집힘).
- 16:05 재연결 뒤 native 프로필(mb-native-clock-v1) 구간은 같은 밴드·같은 펌웨어에서 LE 정상.

## B. dev 회차 0d05175e 참가자별 raw 프로필 (dev_cons.py)
- 10명 중 P05 만 `mb-web-clock-v1`(JS BLE 저장 경로) 4,392 PPG 청크 + EEG 255 + ACC 212, 15:20:13~16:05:12.
- P05 `capture_stream`(측정 엔진 스트림) 은 16:05:40 에 첫 생성. 나머지 9명은 15:20:09.
- P05 feature 는 16:05:46 이후에만 존재(869건), 그 전 0건. `live_command_ledger` capture.* 는 전부 applied(실패·거절 행 없음) → P05 는 15:20~16:05 에 capture.start 자체를 보내지 않음.

## C. 운영 11/18 (prod_1118.py, prod_prof.py, prod_cr.py, prod_m15.py)
- 두 회차 raw 프로필 전부 mb-native-clock-v1(웹 프로필 0). reanchor 0건.
- clock_reset: 몸돌봄 3명(각 3신호 1회씩), 마음돌봄 1명(3신호 1회). PPG 초당 폭주 없음.
- clock_reset 참가자 4명 중 feature 중단: 몸돌봄 1명(01:18 이후 feature 없음, PPG raw 01:19까지), 마음돌봄 1명(06:12 이후 feature 없음, PPG raw 06:39까지), 나머지 2명은 feature 지속.
- feature 0 인 입장자(몸 2·마음 4명)는 capture_stream 0 또는 user_stop/superseded 이고 raw 도 0 — clock_reset 과 무관(미착용·측정 미시작).
