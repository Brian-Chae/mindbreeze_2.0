# SDD-275 Plan

## 1. 원인 추적 근거
- `capture-controller.ts` `makeOutbox`: `store: this.o.outboxStore` — 운영 호출자(`WebMeasurementSession`)는 `outboxStore`를 넘기지 않음(grep: 주입은 tests/ 만) → `MetricOutbox` 기본값 `MemoryOutboxStore`.
- `use-biosignal-expected-reporter.ts`: `new IdbOutboxStore().listScopes()` → 항상 빈 목록 → `observeWebFeatureTotal` 호출 0.
- 재현(임시 vitest): IDB에 `entry:p1` scope outbox + `saveEntry` 가 있으면 훅이 `PUT`을 호출함 → 훅/허브/`resolveExpectedAuth`(accountId 형식 `entry:<pid>` 일치)는 정상. 후보 (a)(c) 기각. (d) 완료 마커는 sweeper가 IDB scope에서 쓰므로 R1 해소 시 동작. (b)는 R3로 확정(sessionStorage 의존).
- 서버: `expected_unknown` 은 `e is None or any(raw is None)` → raw 총량도 보고해야 함(R2). 원시 raw 총량은 `BiosignalQueue`(IDB `sealed_chunks` + `ack_receipts`, 신호별) 로 계산 가능(contract §1: pending+uploading+verified+quarantined).

## 2. 변경 (파일 담당 표 — 단일 워커)
| 파일 | 변경 |
|---|---|
| `lib/measurement-web/capture-controller.ts` | `makeOutbox` 기본 저장소 = `IdbOutboxStore`(indexedDB 있을 때), 없으면 기존 메모리. `outboxStore` 주입은 그대로 우선 |
| `lib/biosignal/expected-reporter.ts` | `ExpectedRecord.entryAuth?`(자격+만료) additive 필드, `ExpectedReporter.attachEntryAuth(scope, auth)`(submit 과 같은 직렬 체인) |
| `lib/biosignal/expected-hub.ts` | `observeWebFeatureTotal(scope,total,complete,{raw,entryAuth})` — raw 총량·자격 영속, push 에 raw 반영 |
| `lib/biosignal/web-raw-totals.ts` (신규) | `BiosignalQueue` 에서 신호별 raw 총량 계산(`objectsMeta`+`receipts`, superseded 제외) |
| `hooks/use-biosignal-expected-reporter.ts` | web 루프에서 raw 총량 계산·자격 영속; `resolveExpectedAuth` 가 loadEntry 없으면 레코드의 영속 자격(만료 전)으로 폴백 |
| `lib/measurement-web/web-measurement-session.ts` | 시작 직후 허브에 scope+자격 등록(탭이 60초 안에 죽어도 복구 가능) |

## 3. 안전장치
- 자격 영속은 `expected_report` 레코드에 `entryAuth{credential,expiresAt}` — 기존 sessionStorage 와 같은 24h TTL, 만료·보고 final 전송 완료 뒤 자격 필드 제거.
- 다른 계정/참가자 scope 는 `accountId`/`participantId` 일치 시에만 자격 사용(기존 규칙 유지).
- 서버 계약 불변(PUT 본문 동일: feature, raw, final).

## 4. 별건(원시 청크 4개 잔류) — 원인 추정만
원시 청크 업로드(`pump`)는 `useBiosignalCapture`(클래스 화면 마운트 중)에서만 돈다. 앱 셸 sweeper(`use-biosignal-resume-sweeper`)는 feature outbox 만 훑고 raw 큐(`sealed_chunks`)는 훑지 않는다 → 화면 이탈·종료 뒤에는 남은 청크가 재시도되지 않을 수 있음. 미확정(운영 로그 필요) — 수정하지 않음.

## 5. 네이티브 필요 여부
불필요. 비회원은 Android·iOS 모두 WebView 의 웹 WASM 경로(PR #226) → 이번 수정은 JS 번들만으로 두 플랫폼 동시 해결(앱 재배포 시 번들 갱신, 네이티브 코드 변경 없음). 네이티브 회원 경로는 불변.
