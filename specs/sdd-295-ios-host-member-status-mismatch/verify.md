# SDD-295 Verify (구현 전 QA 체크리스트)

## 자동 시험 (`frontend/src/lib/class/member-player-case.test.ts`)
- [x] V1 밴드 `on` + 서버 미확정(`serverConfirmed=false`) → 링 대기 문구에 "측정하는 중" 단정이 없고 "연결 확인 중이에요"
- [x] V2 밴드 `on` + 서버 확정(`serverConfirmed=true`) → "측정하는 중이에요" 유지
- [x] V3 `serverConfirmed` 미지정(구 경로·시안) → 기존 문구 유지(회귀 없음)
- [x] V4 밴드 off/pending/leadoff/lost 문구는 `serverConfirmed` 와 무관하게 불변

## 회귀
- [x] `tsc -b` 0 오류
- [x] 회원/상담사 player 관련 vitest 통과, 신규 실패 0 (기존 실패 기준선 제외)

## 확인 못 하는 것
- iOS 실기기 재현(감독이 설치). 앱 재빌드 불필요(웹 번들 변경) 여부는 summary 에 기재.
