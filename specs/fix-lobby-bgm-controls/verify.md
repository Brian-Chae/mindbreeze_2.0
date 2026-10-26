# FIX — 대기 화면 BGM 제어 (verify, 구현 전)

| ID | 시나리오 | 기대 |
|---|---|---|
| V1 | 엔진: play()가 나중에 reject | subscribe 리스너가 호출되고 isBlocked()=true |
| V2 | url 엔진 setVolume(0) / setVolume(0.5) | element.muted 가 true / false |
| V3 | tone 엔진 맥박 트랙 setVolume | LFO gain 이 새 음량 비례로 갱신 |
| V4 | useLobbyBgm: 차단 후 슬라이더 조작 | resume 호출, blocked 해제 |
| V5 | useLobbyBgm: 음량 0(끔) 상태에서 setVolume(0.4) | 음량 0.4, muted=false |
| V6 | WaitStartView: 끈 상태 | 슬라이더 disabled 아님 |
| V7 | 실제 Chrome(로컬 vite 재현 페이지) | 버튼·슬라이더 전후 element.volume/muted/paused 값 변화 기록 |
| V8 | tsc 0, eslint 0, 전체 vitest 기준선(17 fail/8파일) 미증가 | |
