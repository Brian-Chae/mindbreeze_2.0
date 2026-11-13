# [Fix] 녹음 끊김 감지·자동 재시작 — Verify (구현 전 QA 체크리스트)

## 자동 테스트
| ID | 시나리오 | 기대 |
|---|---|---|
| V1 | `recording` 이고 진행 신호가 30초 불변 | `stalled=true`, `onStall` 1회 호출 |
| V2 | 29초까지 불변 | 아직 `stalled=false` |
| V3 | 정지 후 추가로 30초+ 더 불변 | `onStall` 추가 호출 없음(자동 재시도 1회 제한) |
| V4 | 정지 상태에서 진행 신호 증가 | `stalled=false` 로 해제, 이후 새 정지는 다시 1회 자동 복구 |
| V5 | `active=false`(일시정지/마이크 꺼짐) 상태로 60초 경과 | `stalled=false`, `onStall` 없음 |
| V6 | 일시정지 → 재개 직후 | 기준선 리셋(재개 시점부터 30초 계산) |
| V7 | 훅: 네이티브 `recording` 인데 `getStatus` 진행 불변 30초 | `stalled=true`, 네이티브 `resume()` 자동 1회 |
| V8 | 훅: 네이티브 `micOff`(setMicEnabled(false)) 60초 | `stalled=false`, resume 호출 없음 |
| V9 | 훅: `restartRecording()` | 네이티브 `stop()` 후 `startChunkIndex=lastChunkIndex+1` 로 `start()` |
| V10 | 훅: `stateChanged(paused, reason=interruption)` | `pausedByInterruption=true`, 재개 시 false |
| V11 | 배너: `stalled` | 정지 경고 문구 + [녹음 다시 시작] 버튼 노출 |
| V12 | 마이크 꺼짐 배너 | 제목에 `마이크 꺼짐 · 녹음 일시정지` |
| S1 | Swift: `began` 후 9.9초 | `shouldAttempt=false` |
| S2 | Swift: `began` 후 10초 | `shouldAttempt=true`, 시도 기록 후 직후 `false`, 다시 10초 뒤 `true` |
| S3 | Swift: `ended` 수신 후 | 이후 `shouldAttempt=false` |
| S4 | Swift: 사용자 일시정지 중 인터럽션 | 상태기계가 `paused` 유지(기존 테스트 회귀 없음) |
| T1 | `npx tsc --noEmit -p .` | 오류 0 |
| T2 | 기존 녹음·호스트 플레이어 테스트 | 회귀 0 |

## 실기기 시나리오(재빌드 후 수동)
1. iPhone 진행자: 화상 연결 + 녹음 중 → 전화/Siri 인터럽션 → 종료 알림이 오지 않아도 10초 내 자동 복귀, 청크 인덱스 재증가.
2. iPhone/Android 진행자: 녹음 중 블루투스 이어폰 연결·해제(라우트 변경) → 30초 안에 경고가 뜨거나 자동 복구되고, 서버 청크가 이어짐.
3. 마이크 끄기 → "마이크 꺼짐 · 녹음 일시정지" 표시, 경고 배너 없음 → 켜기 시 녹음 재개.

## 비범위
서버 무청크 알림(P1), `incomplete_audio` 표시(P2), 상태 전이 서버 보고(P2).
