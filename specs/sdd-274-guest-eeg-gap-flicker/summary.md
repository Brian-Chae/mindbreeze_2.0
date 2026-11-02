# SDD-274 — Summary

## 결과
| 항목 | 상태 | 근거 |
|---|---|---|
| 지표 "-" 깜빡임(비회원 Android 자기 화면) | **완화 구현** | 집중·이완·감정균형 직전 유효값 15초 유지, 시험 8건 |
| EEG 알림 유실 원인 | **미확정** | 코드 추적으로는 확정 불가 → `ed` 계측 추가, 실기 후 확정 |

## 직전값 유지 규칙
- 15초(≤15000ms 유지, 15001ms부터 "-"): 상담사 화면 `HOLD_LAST_VALUE_MS`와 동일 — 두 화면이 같은 시점에 값이 사라진다.
- 대상: 집중·이완·감정균형만. 호흡·HRV·BPM 불변.
- 적용: 코드 입장 비회원(`!user.id`) + Android + 네이티브 지표(`nativeM.metrics`) 없을 때. 회원·iOS·상담사 화면 불변.
- 즉시 "-" 및 보관분 폐기: 밴드 연결 해제, `lead_off`, 링크 stale. 새 유효값은 즉시 교체. 새 문구 없음(숫자만).
- 유지값은 화면 표시용 snapshot 에만 적용. 저장·ingest·업로드·코어는 불변.

## 원인 가설별 증거
| 후보 | 판정 | 근거 |
|---|---|---|
| (a) 콜백 DataView 버퍼 aliasing | 기각(코드) | `parseRawPacket` 이 콜백 동기 구간에서 `.slice()` 복사, `onRaw` 도 `bytes.slice()` 후 워커로 transfer |
| (b) 이중 처리/이중 구독 | 코드상 단일 | `startNotifications` 가 구독 전 `stopNotifications` 호출. 이중 CCCD 는 코드로 확인 불가(`ed` 의 `d`(duplicate) 수로 실기 확인) |
| (c) 늦은 도착이 gap 을 키움 | 기각 | 코어 gap 은 헤더 tick 기준(`clock.rs admit`), 도착시각은 앵커 보정에만 사용 |
| (d) MTU/연결 파라미터 | 미확인 | 앱 BLE 계층, 코드 밖 |
→ 남는 가설: BLE/브릿지 계층 패킷 드롭·순서 역전. `ed` 의 `g/m/r/x`(누락 합·최대·재충전 추정·tick reset), `o`(out_of_order), `d` 로 판별.

## 계측 `ed`
`entry-state?...&ed=a.d.o.c.i.p.s.b.g.m.r.x` (a 수용, d 중복, o 순서역전, c 충돌, i 무효, p 알림수, s 1.5초↑ 정지, b 5ms 몰림, g 누락 샘플 합, m 최대 누락, r 코어 재충전 추정(누락>2), x tick reset). 개수만, `ld`/`pd` 불변.

## 변경 파일
`lib/session-live/hold-last-snapshot.ts`(신규), `lib/measurement-web/eeg-diag.ts`(신규), `core.worker.ts`, `capture-adapter.ts`, `web-measurement-session.ts`, `lib/api/class-flow.ts`, `MemberClassContainer.tsx`, `tests/sdd274-hold-last.test.ts`, `tests/sdd274-eeg-diag.test.ts`.

## 시험
- 신규 sdd274: 2 files / 14 passed.
- `vitest tests/sdd272 sdd273 sdd274 sdd246-web sdd244 fix- class-flow`: 111 files passed / 1 skipped, 1071 passed / 1 skipped.
- `tsc -b` 오류 0, eslint 오류 0(기존 경고 4).

## 확인 못 한 것
실기(Android 앱) 화면, 앱 번들 반영 후 동작, EEG 유실 실제 원인. 코어 `GAP_SAMPLES_LIMIT` 는 지시대로 변경하지 않음.
