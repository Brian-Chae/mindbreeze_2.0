# SDD-266 — 기대량 최종(final) 보고 유실로 전송 현황 99% 정체 수정

- 상태: Stage ① Spec
- 브랜치: `sdd/266-expected-final-lost`
- 작성일: 2026-11-01
- 선행: SDD-264(기대량 보고), SDD-265(전송 현황 재설계). 서버 계약 `specs/sdd-264-upload-progress-expected/contract.md` 불변.

## 문제
실기기(dev, 회차 4ff9eb00…, 약 90초 측정): 코치 "전송 현황"이 99%에서 멈춘다. 폰 보고는 feature 87 · raw 8/8/7 · **final=false**, 서버 도착은 87 · 9/9/8. 기대량이 종료 시 마지막 청크(+1씩)를 반영하지 못했고 final 이 한 번도 true 가 되지 않아 서버 `progress.state` 가 `all_received` 로 가지 못한다.

## 원인 (코드 근거)
| # | 원인 | 위치 |
|---|---|---|
| C1 | 종료 상태 이벤트(SEALING/DRAINING/CLOSED) 미수신 → `markEnding` 미발동. `emitBatch` 가 foreground·runtime 가드로 종료 직후 상태 이벤트를 내지 않음 | `MeasurementPlugin.emitBatch`, `expected-hub.observeNative` |
| C2 | 스윕 세대의 `reconcile.state.complete` 때 raw 총량이 꼬리만(1/1/1) → `mergeReport` 가 `lagging` 으로 보고 **final 을 prev.final(false) 로 버림** | `expected-reporter.mergeReport` |
| C3 | 꼬리만 세는 이유: `ArchiveQueue.load()` 가 payload 없는 항목을 건너뛰는데 `gcVerified()` 가 verified 항목의 payload 를 삭제 → 재기동·스윕 큐에서 verified 청크가 사라져 `signalCounts()` 가 부분 합 | `ArchiveQueue.load/gcVerified` (Android; iOS 는 저널 유지로 해당 없음) |

## 목표
1. 종료(정지·봉인)를 어떤 경로로든 최소 1회 hub 가 알아 final=true 를 보낸다.
2. 병합 후 총량(필드별 max)이 서버 입장에서 뒤처진 값이 아니므로 final=true 신호를 OR 로 반영한다.
3. 로컬 큐 재집계가 세션 전체 총량을 내도록 Android 큐 로드를 교정한다(verified 항목은 payload 없이도 계수).
4. 오프라인·재기동에서도 final 이 IDB 1건에 영속되고 단조 유지된다.

## 범위 밖
서버(`backend/**`)·화면 컴포넌트·앱 빌드. 서버가 final=false 로 영원히 막는 한계의 완화안은 `impl-notes.md` 에 제안만 쓴다(대표 결정 사항).
