# SDD-272 — Summary

## 결과
| 항목 | 상태 |
|---|---|
| 앱 시각 보정 재시도 (Android) | 구현 + 단위 시험 279건 통과 |
| 앱 시각 보정 재시도 (iOS) | 구현 + 시험 3건 작성. **구문 검사만 통과**(xcframework 없어 `swift test` 불가) |
| 앱 시각 보정 재시도 (웹) | 구현 + vitest 5건 통과 |
| 표시 방어 | 프런트 구현 + vitest 7건 통과. 서버 변경 없음 |
| 비회원 "다음" | 원인 코드 확정 + 수정 + 재현 시험 통과 |

## 원인
1. **지표 "-"**: 시각 보정(reanchor)이 안 풀려 서버가 `time_uncertain`으로 보냈고 프런트가 값을 가렸다. Android는 첫 뇌파 패킷 전이면 reanchor를 보내지 않고 5분 뒤로 미뤘다. 2분 회차는 재시도 기회가 없었다. iOS·웹도 실패 시 5분 대기.
2. **비회원 "다음" 무반응**: `EntryPage`의 리포트 반영 재확인 시트가 `PlayerShell`(`position:fixed; inset:0`) 밖에 렌더되어 가려졌다. 비회원은 `report_included=false`라 항상 이 분기를 탄다. 기존 시험은 텍스트 존재만 봤다.

## 변경
- 재시도 정책(3플랫폼 동일): 2·4·8·15·15·15·15·15초, 최대 8회 후 5분 주기. 매번 새 probe. 성공 = ACK `applied|duplicate` 이고 `clock_uncertain!=true`. 새 stream/재연결 시 리셋. Android·iOS 앵커 최초 생성 시 즉시 1회.
- 표시: `live-state`가 `received_at_server_ms`(서버 시계)를 보관, `time_uncertain` 값은 수신 후 5초 이내 fresh·30초 이내 delayed·초과 stale. 수신 시각 없으면 기존대로 가림. `timeUncertain` 표식 제공. `observed_at_ms`는 null 유지라 5분 막대에는 안 들어간다.
- 선택 근거: 서버에 필드를 추가하면 `MetricsEntity` `additionalProperties:false` 계약·골든 갱신 필요. 서버 쪽에서 fresh로 올리면 시각 불확실 값을 최신으로 오인. 프런트가 이미 받는 이벤트 봉투 값만 쓰면 계약·저장·ingest 무변경.
- 비회원: `overlaySheet`로 시트를 틀 안 슬롯에 전달.

## 시험 결과
| 구분 | 결과 |
|---|---|
| Android `testDevDebugUnitTest` | 279건, 실패 0 |
| vitest 신규 | sdd272 2파일 12건 + EntryPage 시트 1건 통과 |
| vitest 전체 | 3894 통과 / 21 실패 — **기준 커밋 1a02a5e2에서도 같은 11개 파일 21건 실패**(기존 문제) |
| tsc · eslint | 오류 0 |
| pytest sdd246 ingest·t12b | 32건 통과(서버 변경 없음). `jsonschema` 미설치 환경이라 임시 경로로 설치해 실행 |

## 확인 못 한 것
- 실기기 재현(앱 빌드 금지). 운영 5bcca158 회차의 reanchor 0건은 로그상 부합하나 앱 내부 로그는 보지 못했다.
- iOS `swift test`.
- 비회원 시트가 실제 화면에서 가려지는 것은 DOM 구조(셸 밖)로 확정. 실기기 시각 확인은 안 했다.
- 다른 화면(상담사 목록 등)에서 `timeUncertain` 보조 표기 문구는 아직 UI에 노출하지 않았다(필드만 제공).
