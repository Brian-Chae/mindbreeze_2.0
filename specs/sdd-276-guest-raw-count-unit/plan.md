# SDD-276 Plan

## 변경 (단일 워커, 파일 담당)
| 파일 | 변경 |
|---|---|
| `frontend/src/lib/biosignal/web-raw-totals.ts` | sealed 와 receipt 를 객체 id 합집합으로 센다(양쪽에 보이면 1건). 레거시 v1 eeg 청크 수를 `legacyEeg` 인자로 더한다 |
| `frontend/src/lib/session-live/raw-chunk-queue.ts` | 레거시 청크가 새로 큐에 들어갈 때 같은 IDB 트랜잭션에서 (session,participant)별 생성 수를 `next_indices` 스토어에 증가(`legacy-raw|…`). `readLegacyRawCount()` 추가 |
| `frontend/src/hooks/use-biosignal-expected-reporter.ts` | 웹 루프에서 레거시 수를 읽어 `computeWebRawTotals` 에 전달 |
| `frontend/tests/sdd276/*` | 신규 시험 |

## 안전장치
- IDB 스키마 버전 불변(기존 `next_indices` 재사용, 키 접두사 분리).
- 카운터는 "큐에 새로 들어간 청크"만 증가(멱등 재적재는 증가 없음). 용량 초과로 밀려난 청크도 만들어졌으므로 그대로 센다(서버에 안 올라간 만큼 부족으로 보임 — 사실 그대로).
- 네이티브 회원 경로(archive.counts)는 불변.

## chunk_index 판정 (과제 3)
서버 UNIQUE = (session, participant, signal_type, stream_id, segment_id, chunk_index). 웹 ppg/acc 는 segment 마다 index 0부터라 segment_id 가 다르면 별개 행 → 덮어쓰기 없음. 같은 identity 에 다른 checksum 이면 409(chunk_identity_conflict)로 거절되고 폰은 dead_letter 보관(덮어쓰기 아님). 잔존 위험: alias 가 segment UUID 앞 8자리만 쓴다(32비트, 수천 segment 에서 충돌 확률 ~1e-4) — 충돌 시에도 alias_conflict 409 로 거절·보관되며 덮어쓰지 않음.

## 네이티브 필요 여부
불필요. 비회원은 Android·iOS WebView 의 웹 경로 → JS 번들 갱신만으로 두 플랫폼 동시 적용.
