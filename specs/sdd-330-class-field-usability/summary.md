# SDD-330 — Summary

## 결과
| 항목 | 커밋 | 내용 |
|---|---|---|
| B 팝업 제거 | 7b3f350f | 코치마크 컴포넌트·로직·테스트 삭제, 컨테이너 연결 제거 |
| C 코치 라이브 | b8bb2165 | 입장자 기본 보기, 입장·이상 요약, 전체 보기/이상만 보기 |
| A 권한 바로가기 | fdecf2e3 | AppSettings 플러그인(Android·iOS), 버튼 3종, 매니페스트 권한 |

## B 사실 확인 — "확인 안 누르면 입장 안 됨"?
- **사실 아님.** 코치마크는 입장이 끝난 뒤 플레이어 화면(`MemberClassContainer`) 안에서만 마운트되고, `onFinish` 콜백은 어디에도 연결돼 있지 않았다. 입장 처리(자격 발급·참가자 등록)는 그 이전 단계(`CodeEntryPage`/`EntryPage`)에서 끝난다. 팝업이 화면을 덮어 "입장 안 된 것처럼" 보였을 가능성만 있다.
- 법적 동의 화면은 별개 코드이며 변경하지 않았다.
- 저장 키 `mb_class_onboarding_seen` 은 더 이상 읽거나 쓰지 않는다(기존 사용자 브라우저에 남은 값은 무해).

## C 정의
- 입장자 = `enteredAt` 가 있거나 현재 접속 중(`presenceState==='connected'`).
- 이상 = 입장자 중 연결 끊김 · 접촉 불량 · 배터리 부족 · 입장 후 현재 미접속. 밴드 미착용은 선택 사항이라 이상 아님.
- 1:1 은 상대가 한 명뿐이라 필터 미적용. 숫자 점수·등급 없음.
- 서버 `entered_at` 이 입장 판정의 정본(`host-live-model.ts` 가 그대로 전달). 백엔드 무변경.

## A 앱 빌드 필요
- 네이티브 코드(Android `AppSettingsPlugin.java`·MainActivity 등록·매니페스트 권한, iOS `AppSettingsPlugin.swift`·pbxproj·MBBridgeViewController) 추가 → **스토어 앱엔 다음 빌드부터 적용**. 구버전 앱은 플러그인이 없어 버튼 호출이 실패해도 예외 없이 기존 안내 문구만 보인다.
- Play 정책: `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 는 사유(실시간 생체신호 BLE 측정) 신고 필요.
- 네이티브 빌드는 하지 않았다. 검증은 `swiftc -parse` 구문 통과, pbxproj `plutil -lint` OK까지. Android Java 는 컴파일 미실행(감독 빌드 시 확인 필요).

## 테스트
- 신규: `sdd330-host-entry-scope`(5), `sdd330-permission-shortcuts`(5), `class-player-host-view` +3.
- 관련 묶음(host·member·flow·sdd303·sdd220) 통과, tsc 0, eslint 변경 파일 0.
- 전체 vitest: 50 실패 = develop(origin) 기준과 **동일한 실패 세트**(20개 파일, 새로 깨진 것 없음). `sdd320f-live-skin` 포함.
- 캡처: `~/.hermes/share/sdd330-shots/` (host-entered-default / show-all / abnormal-only × 1440·390, perm-band-step-390).
- 로컬 Python 멈춤으로 백엔드 pytest 불가 — 백엔드 변경 없음.
