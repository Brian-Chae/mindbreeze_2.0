# SDD-295 — iOS 상담사·회원 화면 측정 상태 불일치 수정

- 상태: Stage ①~⑥ 완료(감독 리뷰 대기)
- 브랜치: `sdd/295-ios-host-member-status-mismatch`
- 작성일: 2026-11-05

## 1. 증상
iOS 빌드 2 실기기(온라인 회차): 상담사 화면은 이 회원을 "체크인 완료"로, 회원 화면은 "측정하는 중이에요"로 표시.

## 2. 확정 원인 (서버 기록 + 코드)
dev 서버 읽기(11/5 KST 10:06 회차, 온라인·그룹 `98b052`): 참가자 `b7ed3a` 는 체크인 완료, `band_connected=false`. 이 회차에는 `capture.start` 0건, `capture_stream` 0건, `metrics.updated` 0건, `eeg_feature_windows` 0건 — 서버에는 측정 데이터가 한 건도 도착하지 않았다. (같은 날 오프라인 3회차는 start 1~5건·windows 31~310건으로 정상.)
- 상담사 화면(`HostParticipantGrid.checkinLabel` ← `row.checkin_state`)은 서버 사실대로 "체크인 완료".
- 회원 화면(`MemberStage.HeroRing`)은 `deriveRing` 이 로컬 밴드 상태(`bandUi==='on'`)만으로 `gauge` 를 내고, 값이 null 이면 서버 도착 여부와 무관하게 "측정하는 중이에요"를 고정 출력했다. 서버 확정 전 단정 표현이 원인.

## 3. 대조표
| 화면 | 문구 | 판정 코드 | 입력 신호 |
|---|---|---|---|
| 상담사 | 체크인 완료 | `HostParticipantGrid.checkinLabel` | 서버 `checkin_state` (체크인이라는 별개 사실) |
| 상담사 | 연결됨/수신 | `hostBandOf` | 서버 `band_connected`·`last_eeg_at`·`device_status` (서버 도착 기준) |
| 회원(수정 전) | 측정하는 중이에요 | `MemberStage.HeroRing` | 로컬 `bandUi==='on'` + 값 null |
| 회원(수정 후) | 서버 확정 전: 연결 확인 중이에요 / 확정 후: 측정하는 중이에요 | `deriveRing.waitingText` | 로컬 밴드 + 서버 live v2 `metrics[participantId]` 존재 |

## 4. 수정 (최소)
- `MemberCaseInput.serverConfirmed?: boolean` 추가. `MemberClassContainer` 가 v2 일 때 `liveV2.state.metrics[participantId]` 존재 여부로 채운다(구 경로 undefined → 기존 문구).
- `deriveRing` 가 게이지 대기 문구 `waitingText` 를 낸다(`serverConfirmed===false` → "연결 확인 중이에요").
- `MemberStage` 는 `ring.waitingText` 를 쓴다.
- 상담사 화면은 이미 서버 기준이라 변경 없음. 금지 표현 추가 없음.
