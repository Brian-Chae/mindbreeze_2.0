# FIX — 클래스 대기 화면 BGM 끄기·음량 조절 불동작 (plan)

## 원인 (코드 분석)
1. `audio-engine.ts` url/tone 엔진: `play()` 직후 `isBlocked()`를 동기로 읽고, 나중에 play() Promise가 reject돼도 React에 알릴 길이 없음 → 회원 대기실이 "재생 중"으로 거짓 표시, 버튼은 `toggleMute`(음량 0)만 호출해 소리 상태와 어긋남.
2. `WaitStartView` 슬라이더가 `disabled={!playing}` → 끈 상태(음량 0)에서 슬라이더를 올릴 수 없음.
3. url 엔진 `setVolume`은 `element.volume`만 설정 → iOS WKWebView는 무시. 0일 때 `muted` 처리 없음.
4. tone 엔진 맥박 LFO 진폭이 생성 시점 음량으로 고정 → 음량 변경이 가이드 트랙 맥박에 반영 안 됨.
5. 호스트: 1초 폴링으로 보정되나 지연.

## 수정
- AudioEngine에 `subscribe(listener)` 추가(blocked/playing 변화 통지). 훅(useLobbyBgm·useClassAudioPlayer·useGuestAudioSync)이 구독해 상태 즉시 반영.
- url 엔진: `setVolume`에서 `element.muted = (volume===0)`, 음량 0→양수 시 정지돼 있으면 재생 재개.
- tone 엔진: LFO 진폭도 `applyVolume`에서 갱신.
- useLobbyBgm: `setVolume`·`toggleMute`가 사용자 제스처로 `resume()` 호출(차단 해제). 슬라이더 항상 활성.
- iOS: HTMLAudioElement 대신 GainNode(MediaElementSource) 경유는 교차 출처 오디오에서 무음이 될 위험이 있어 채택하지 않고, 끄기(muted)·0 처리만 보장. 중간 음량은 iOS 하드웨어 볼륨 한계(문서화).
