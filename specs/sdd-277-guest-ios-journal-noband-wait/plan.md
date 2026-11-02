# SDD-277 Plan

## 1. 원인 (코드 + 운영 읽기 전용 집계)
### A. raw journal 중단 — 확정 부분 / 미확정 부분
| 사실 | 근거 |
|---|---|
| 실제로 원시 기록이 끊겼다 | 운영 회차 0dd26f7a 비회원(b3b582d1): raw 청크 eeg/ppg 각 1건(21:29:01)뒤 없음, gap `local_write_failed/unknown` 1건, 회차는 21:30까지. 같은 참여자 feature outbox(108창)는 계속 도착 → outbox 오류가 raw 를 멈춘 것이 아니라 raw 쪽 journal 쓰기가 독립으로 실패 |
| 오류 1회가 곧 영구 중단 | `capture-session.ts` receive→`journalPacket` 실패 시 재시도 없이 `stop('journal_failed')`(비가역). 연결 핸들(`BiosignalQueue.dbPromise`)은 한 번 열면 닫혀도 다시 열지 않음 |
| SDD-275 가 연결을 늘렸다 | `computeWebRawTotals(new BiosignalQueue(...))` 가 60초마다 새 큐 = 새 `openRawDb()` 연결을 만들고 닫지 않음(+ `ensureIndex` 가 sealed_chunks 를 payload 포함 커서로 훑음). IdbOutboxStore·IdbExpectedStore·sweeper 도 각자 연결. vc42(SDD-275 이전)에는 이 연결 증가가 없음 |
| 미확정 | iOS WKWebView 의 실제 오류 이름(InvalidStateError/UnknownError/QuotaExceeded 등)은 기기 로그가 없어 단정 불가 → 가설 1순위=연결 소실·누적, 2순위=트랜잭션 경합. 이를 위해 additive 계측(중단 사유 오류 이름·메시지를 콘솔 + `stopDetail`)을 넣는다 |
### B. 밴드 없는 입장 "전송 대기"
- 웹 보고 scope 는 feature outbox(`listScopes`)에서만 만들어진다 → capture.start 가 없으면 scope 0 → `ingest-expected` 호출 0.
- 서버 `build_participant_progress`: `e is None` → `expected_unknown`, UI 는 `집계 대기`. final 이 영영 오지 않는다.

## 2. 해결 (웹만)
| # | 변경 | 파일 |
|---|---|---|
| T1 | 장수명 저장소용 **공유 IndexedDB 연결**(`sharedRawDb`) + 연결 소실 감지 시 폐기·재오픈. 기존 `openRawDb`(호출자가 close 하는 용도)는 유지 | `biosignal/queue-db.ts` |
| T2 | `BiosignalQueue`·`IdbOutboxStore`·`IdbExpectedStore` 가 공유 연결을 쓰고, 연결 오류(InvalidStateError/UnknownError/connection lost) 시 1회 재오픈 후 재시도 | `durable-queue.ts`, `metric-outbox.ts`, `expected-reporter.ts` |
| T3 | `journalPacket` 실패 시 즉시 중단하지 않고 재오픈·백오프 재시도(최대 3회, 메모리 `unpersisted` 사본 유지, 8MB 상한 기존 그대로). lease 오류는 기존대로 즉시. 최종 실패 시에만 `journal_failed` + 오류 상세 기록 | `capture-session.ts` |
| T4 | (삭제) 관측기가 큐를 새로 만들어도 T1 공유 연결 덕에 연결이 늘지 않는다. 큐 재사용은 오히려 `metaIndex` 캐시가 낡아 부정확해지므로 하지 않는다 | — |
| T5 | 밴드 없는 입장 종료 시 0/0/0/0 final 보고: 해당 scope 에 outbox·raw 사본이 하나도 없을 때만. 입장 자격 사본 영속(화면 이탈 후 재전송) | `no-band-final.ts`(신규), `EntryPage.tsx` |

## 3. 위험·메모
- T3 재시도 중에도 패킷은 메모리 사본으로 보존. 재시도 총 대기 ≈ 1.75초 이내라 8MB 상한(≈수십 초 분량) 안.
- T5 는 데이터가 하나라도 있으면 보고하지 않음 → 측정한 사람을 0 으로 덮지 않는다(서버도 단조 max 병합).
- 네이티브 수정은 하지 않는다. iOS 네이티브 WebView 의 IndexedDB 이탈은 JS 측 재오픈으로 대응.
