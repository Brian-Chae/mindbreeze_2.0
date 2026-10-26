# FIX — 클래스 대기 화면 BGM 끄기·음량 조절 (summary)

## 원인
1. 회원 대기실 슬라이더가 `disabled={!playing}` — 끈 상태·자동재생 차단 상태에서 올릴 수 없었음(핵심).
2. play() 거부는 비동기인데 훅이 play() 직후 동기 값(`isBlocked`)만 읽어, 차단돼도 "재생 중"으로 표시되고 호스트는 최대 1초 지연.
3. url 엔진은 `element.volume`만 설정 → iOS WKWebView는 무시, 0일 때 `muted` 없음.
4. tone 엔진 가이드 트랙의 맥박(LFO) 진폭이 생성 시점 음량에 고정 → 음량 변경 미반영.

## 수정
- `audio-engine.ts`: `subscribe()` 추가, play 거부·ctx.resume 결과 시 통지. url 엔진 `muted = (volume===0)`, `resume()`은 공통 `tryPlay`. tone 엔진 LFO gain도 음량 연동.
- `useLobbyBgm.ts`: 엔진 구독으로 blocked 반영, `setVolume`/`toggleMute`가 차단 상태면 재생 재개(슬라이더 조작도 사용자 제스처).
- `WaitStartView.tsx`: 슬라이더 disabled 제거.
- `useClassAudioPlayer.ts`·`useGuestAudioSync.ts`: 엔진 구독으로 blocked·playing 즉시 반영(1초 폴링 의존 제거).

## 시험
- 신규 `tests/fix-lobby-bgm-controls.test.tsx` 4건: RED(4 fail) → GREEN. 기존 2개 테스트를 새 동작(슬라이더 상시 활성, engine mock에 subscribe)에 맞게 갱신.
- tsc 0, eslint 0(변경 파일), 전체 vitest 17 fail/8파일 = 기준선 동일(3346 pass).
- 실제 Chrome(로컬 vite, Playwright) 엔진 값: 생성 volume .6/muted false/paused true → play 후 paused false → setVolume(0) volume 0·muted true → setVolume(.3) volume .3·muted false.

## 한계·미확인
- dev 사이트 로그인 재현은 계정 잠금 위험으로 하지 않음. 헤드리스 Chrome은 자동재생 차단이 재현되지 않아 차단 경로는 vitest로만 검증.
- iOS: 중간 음량은 하드웨어 볼륨이 결정(WebKit 제약). 끄기(0 → muted)만 보장. GainNode 경유는 교차 출처 오디오 무음 위험으로 채택하지 않음. 실기기 확인 필요.
- 회원 라이브 GuestAudioPanel·MemberSheets는 슬라이더 disabled 없음 확인, 훅은 구독 반영만 추가.
