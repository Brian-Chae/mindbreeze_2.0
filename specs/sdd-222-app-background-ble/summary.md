# SDD-222 Summary — 앱 백그라운드 BLE·서버 통신 유지

- 상태: Stage ⑥ Summary — Brian 최종 리뷰 대기 (사후 정리: 2026-10-20 통합 이후 작성)
- 브랜치: `sdd/222-integrate`(트랙 `sdd/222-ios`·`sdd/222-js` 병합) → develop 병합 `8a24a400` (2026-10-20)
- 근거: spec/plan(부록 A·B·C)/verify, 커밋 기록(`git log --grep 'sdd-222'`)
- 문서·커밋에 기록된 사실만 적는다.

---

## 1. Task별 결과

| Task | 내용 | 상태 | 커밋 |
|---|---|---|---|
| T-J0 | keep-awake 8.0.1·foreground-service 8.1.0 설치, cap sync, 스파이크 결과(plan 부록 A) — 플러그인 사용 가능 판정 | 완료 | `ba17ac6c` |
| T-A1~A3 | Android FGS Manifest(`FOREGROUND_SERVICE`·`_CONNECTED_DEVICE`, `connectedDevice`)·알림 아이콘·SDK 요건 확인(부록 B) | 완료 | `2bb36970` |
| T-A2 | WebView 타이머 스파이크 | 소스 분석으로 판정(부록 B.2). 실기기 확인은 미수행 | — |
| T-I1~I2 | `UIBackgroundModes`(`bluetooth-central`, `audio`), `AVAudioSession` playback(부록 C) | 완료 | `a212edd8` |
| T-J1·J2 | 재연결 지수 백오프 정책, BLE 끊김 구간 로그(링버퍼) | 완료 | `f92be56c` `70d3e34a` |
| T-J3·J4 | `useBand` 재연결 루프 교체(실패 시에도 지속), 어댑터 `verifyConnection` | 완료 | `46523abf` `4470adbf` |
| T-J5·J6 | 앱 생명주기 구독·`useAppResume`, 복귀 처리(소켓 재연결·heartbeat, raw 즉시 flush, BLE 확인, 오프라인 flush 유실 방지) | 완료 | `db660a34` `26eea556` |
| T-J7 | BLE 콜백 경로 5초 throttle raw flush | 완료 | `fa636297` |
| T-J8 | `useWakeLock` 네이티브 KeepAwake 분기(웹 경로 불변) | 완료 | `b822d15c` |
| T-J9 | Android FGS 제어(`background-session`, `useBackgroundSession`), EntryPage 연결, 배터리 최적화 안내 모달, 웹 번들 가드 테스트 | 완료 | `760735be` `d6d930c4` `fb9e022d` |
| T-X | V29·V30 네이티브 설정 정적 검증 테스트 | 완료 | `bfa8a304` |
| T-A4 | (D3) `FOREGROUND_SERVICE_MICROPHONE` 권한, 서비스 `foregroundServiceType="connectedDevice\|microphone"`(`RECORD_AUDIO` 기존 재사용) | 완료 (Manifest XML 문법만 확인, `assembleDevDebug` 미수행) | 2026-10-20 `sdd/222-host-background` |
| T-J10 | (D3) `useBackgroundSession(active, role, microphone)`, `useHostBackgroundSession`(ClassPlayerPage 연결), `recoverHostLiveKit`+`HostLiveKitBridge` 복귀 처리, `useClassAudioPlayer` 복귀 재동기화, 복귀 시 경과 시각 즉시 재계산 | 완료 (vitest 목 기준) | 2026-10-20 `sdd/222-host-background` |

D3(상담사 화면 포함)은 spec 범위에 추가(`4f9c1252`)됐고, 통합본(`8a24a400`)에는 구현이 없어 회원 앱 화면(G1~G6)만 적용돼 있었다. 이후 `sdd/222-host-background` 브랜치에서 T-A4·T-J10 을 구현했다(아래 §D3 구현 기록).

---

## 2. 테스트 결과 (기록된 것만)

- 단위 테스트: 각 Task 커밋이 vitest 단위 테스트와 함께 들어갔으나, Task별 통과 수치는 커밋·문서에 기록되어 있지 않다.
- Android: `./gradlew assembleDevDebug` **BUILD SUCCESSFUL**(plan 부록 B.5, T-A1 시점).
- iOS: `plutil -lint` OK, `swiftc -parse`(AppDelegate) OK, AVAudioSession 시그니처 시뮬레이터 SDK 타입체크 OK. 전체 `xcodebuild` 는 `node_modules` 미설치로 SPM 해석 실패(환경 사유)(부록 C).
- 통합 로컬 검증: 백엔드 3389 passed, 프론트 실패 12건은 develop 기준선과 동일. 최종 Deploy Dev 스모크 7/7, 여정 32/32, 회귀 1/1, 전수조사 25/25 통과.
- **실기기 수동 테스트(verify 구간 B, M1~M21)는 수행 기록이 없다.** verify 기준상 에뮬레이터·시뮬레이터 결과는 인정하지 않으므로 출시 차단 항목은 미검증이다(부록 B.6, C 의 "실기기 필요(미수행)").

---

## 통합 기록 (2026-10-20, SDD-220~224 일괄 통합)

SDD-220~224 를 같은 날 develop 에 일괄 통합했다. 병합 커밋: 223 `6c86ec92` · 222 `8a24a400` · 224 `5c5c190f` · 220 `b6f57a45` · 221 `8e1b12e2`, 통합 보정 `dd334ae4`.

- 충돌 해결: `useEegRawUpload.ts` import, `package.json`(Capacitor 8.5.3 + keep-awake 동시 반영), android `strings.xml`, `DashboardPage.tsx`(SDD-221 쪽 채택).
- 로컬 검증: 백엔드 **3389 passed**, 프론트 실패 **12건은 develop 기준선과 동일**(통합으로 늘지 않음).
- 이후 수정: `d401fbd1` dev 배포 빌드를 `mode=dev` 로 변경(SDD-220 의 운영 빌드 분기가 dev 번들에 운영 API 주소를 넣어 dev 로그인이 실패하던 문제), `f89e5a24` 스모크를 녹음·녹화 필수 동의 체크와 AI 비공개 기본값에 맞춤.
- 최종 Deploy Dev 스모크: **7/7**, 여정 **32/32**, 회귀 **1/1**, 전수조사 **25/25** 통과.
- dev 는 AI 비공개 상태로 테스트하기로 결정(Brian).
- SDD-222 와 SDD-220 이 모두 Capacitor 의존성을 바꿨다. `package.json` 은 Capacitor 8.5.3 + keep-awake 를 함께 담는 것으로 해결했다. `useEegRawUpload.ts` import 충돌도 이때 해소했다.

---

## 3. 남은 일 · 이월

1. **실기기 검증(차단)**: Android 14+ FGS 시작·LOW 알림, 화면 끄고 5·20분 BLE 유지, 제조사 절전에서 서비스 생존, iOS 잠금 중 BLE notify(M7)·음성 유지(M8), 밴드 off/on 재연결(M10).
2. **D3 상담사 화면**: 구현·vitest 는 끝났다. verify H1~H12 는 **실기기 미수행**. V37·V40·ClassPlayerPage 연결은 정적/목 검증이다(아래).
3. 배터리 최적화 설정 화면 이동 버튼은 제안만 있고 구현하지 않았다(부록 B.4, 실기기 결과 후 결정).
4. iOS 인터럽트(전화 등) 종료 후 세션 재활성화는 범위 밖으로 미구현(M8 결과에 따라 후속).
5. 스토어 제출 사유 문구(plan §8) 승인 필요.

---

## D3 구현 기록 (T-A4·T-J10, `sdd/222-host-background`)

- **Manifest**: `FOREGROUND_SERVICE_MICROPHONE` 추가, 서비스 타입 `connectedDevice|microphone`. XML 파싱 OK. Gradle 빌드는 수행하지 않음.
- **background-session**: `startBackgroundSession({ microphone })` — 온라인 호스트는 `16|128`(144), 그 외·회원은 `16`. 마이크 타입 시작이 거부되면(권한 거부, H10) `connectedDevice` 로 재시도해 BLE 유지를 우선한다. 실행 중에는 타입을 바꾸지 않는다(멱등).
- **훅**: `useBackgroundSession(active, role='member', microphone=false)` — 회원은 옵션 없이 호출(기존 동작 불변). `useHostBackgroundSession` 이 `isHost && (isLobby||isRunning)` 로 `ClassPlayerPage` 에서 호출, `online` 이면 마이크 타입.
- **복귀 순서**: 소켓(order 10, 기존) → LiveKit 확인·재연결(50, 끊김 상태일 때만 `LiveKitRoom` key 증가로 재마운트) → 카메라 `setCameraEnabled(true)`(camOn 일 때) → 음원 `seek` 재발행(60, 재생 중일 때만, blocked 면 엔진 resume 후) → 경과 시각 즉시 재계산. 단계별 독립 try/catch. 신규 `lib/native/host-resume-recovery.ts`.
- **웹**: `subscribeAppResume` 은 비네이티브에서 no-op, `background-session` 은 Android 외 no-op 이라 웹 경로는 불변. 웹 번들 가드 테스트 통과.
- **테스트**: 신규 5개 파일(+기존 3개 확장) — host-resume-recovery 6, host-livekit-bridge-resume 4, class-audio-resume 4, host-background-session 7, background-session +4, use-background-session +4, native-config 갱신. 기존 host 컨테이너 테스트 3개의 livekit 목에 `useRoomContext` 추가(Bridge 가 사용).
- **전체 vitest**: 2426 중 2414 통과 / 12 실패. 실패는 develop 기준선과 동일한 7개 파일(`agent-counselor-page`·`chat-message-deeplink`·`font-scale` 5건 + `*-browser/pdf.test.cjs` 가 dev 서버(5175) 연결 거부로 7건)이며 이번 변경과 무관(변경 stash 후 앞 3개 파일 동일 5건 실패 확인). `npx tsc -b` 오류 없음, `npx vite build --mode dev` 성공.
- **V별 검증 수준**: V33·V34·V35·V41 훅/목, V36·V37·V38 `recoverHostLiveKit`·Bridge 컴포넌트 목, V39 오디오 훅 목, V40 은 `useBand` 의 `enabled: !observationOnly` 를 정적으로 확인(기존 코드, 런타임 테스트 아님), `ClassPlayerPage` 연결은 정적(소스 문자열) 확인.
- **실기기 미수행**: H1~H12 전부(화면 끄기 5·20분, 알림 탭, 전화 수신 복귀, 마이크 거부, 오프라인 대면 등).

### 남은 위험 · 이월
1. 복귀 시 음원 재발행은 소켓 재연결 직후 실행되므로 소켓이 아직 붙지 않았으면 `sendAudioSync` 가 실패(false)할 수 있다(heartbeat 가 다음 주기에 수렴). 실기기 H4 에서 확인 필요.
2. LiveKit 재마운트는 기존 토큰을 재사용한다. 토큰 만료 시 재연결이 실패할 수 있다(별도 재발급 경로 없음).
3. 호스트 화면에는 배터리 최적화 안내 모달을 연결하지 않았다(`BatteryGuideDialog` 가 `EntryPage` 내부 컴포넌트). 필요하면 공용 컴포넌트로 추출 후 후속.
4. Android 14+ 에서 `microphone` 타입은 `RECORD_AUDIO` 런타임 권한 보유가 시작 조건 — 거부 시 `connectedDevice` 로 폴백하나 이 경우 백그라운드 음성 송출은 OS 가 막을 수 있다(H10 실기기).
5. 스토어 제출 사유 문구(plan §8)의 `microphone` 항목 승인 필요.
