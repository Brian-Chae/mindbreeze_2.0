# 통합 1105c — SDD-293~298 머지 기록

기반: develop 687967bb / 브랜치 `integ/1105-fixes`

## 머지 순서
| SDD | 머지 커밋 | 비고 |
|---|---|---|
| 294 | 112dd42e | 충돌 없음 |
| 296 | 5844d42f | 충돌 없음 |
| 295 | a13b4575 | 충돌 없음 |
| 297 | a226c016 | 충돌 없음 |
| 298 | e5031acd | 충돌 없음 |
| 293 | 4cdb3db5 | 충돌 3파일 해소 |

## 충돌 해소 (293 머지 시)
- `useCloseBiosignalOnEnd.ts`, `MemberClassContainer.tsx`: 298 방식(세 번째 인자 `release`, close 성공·실패 무관 1회 호출)으로 통일. 293의 `after`/`nativeM.path !== 'native'` 분기 제거.
- `use-native-measurement.ts`: import 충돌만 — 293의 `band-hold` import + 298 쪽 `UploadProgress` 타입 import 둘 다 보존.
- `BandBLE.swift`: 자동 병합(충돌 없음). `disconnect()`에 `holding/holdReady` 초기화 + 298의 `retrieveConnectedPeripherals` 해제 + `os_log` 모두 유지, 보류 해제와 일반 해제가 같은 함수를 거침.

## 검증
| 항목 | 결과 |
|---|---|
| `tsc -b` | 오류 0 |
| vitest 전체 | 13파일/23건 실패 (기준선 23건/13파일과 동일, 신규 0). 통과 4155 |
| vitest 대상(293·294·284·295·297·use-close·capacity-increase) | 8파일 72건 전부 통과 |
| Android JVM (`:app:testDevDebugUnitTest`) | LinkWatchdogTest 10, FencingTest 4, BandHoldPolicyTest 7 — 실패 0 |
| SwiftPM `swift test` | 255건 중 7 skipped, 실패 0 |
| 금지어 grep (신규 frontend/src 추가 라인) | 0건 |
| 변경 파일 범위 | 6개 SDD 변경 파일 외 없음 |

## 미확인
- 실기기 BLE 동작(해제 1회·조기 인계 지연) 미확인 — 실기기 시험 필요.
