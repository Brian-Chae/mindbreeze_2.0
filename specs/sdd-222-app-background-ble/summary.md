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
| **T-A4** | (D3) `FOREGROUND_SERVICE_MICROPHONE`, `connectedDevice\|microphone` | **미구현** — develop 의 Manifest 는 `connectedDevice` 단독 | — |
| **T-J10** | (D3) 상담사 화면 백그라운드 세션·LiveKit 복구·음원 재동기화 | **미구현** — `useBackgroundSession` 은 `EntryPage`(회원)에만 연결, `ClassPlayerPage` 호스트 연결 없음 | — |

D3(상담사 화면 포함)은 spec 범위에 추가(`4f9c1252`, 문서만)됐으나 구현 커밋이 없다. 따라서 이번 통합본은 **회원 앱 화면(G1~G6)만** 적용된 상태다.

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
2. **D3 상담사 화면**: T-A4·T-J10 구현과 verify V33~V41·H1~H12 검증이 남았다.
3. 배터리 최적화 설정 화면 이동 버튼은 제안만 있고 구현하지 않았다(부록 B.4, 실기기 결과 후 결정).
4. iOS 인터럽트(전화 등) 종료 후 세션 재활성화는 범위 밖으로 미구현(M8 결과에 따라 후속).
5. 스토어 제출 사유 문구(plan §8) 승인 필요.
