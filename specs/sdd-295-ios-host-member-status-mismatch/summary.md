# SDD-295 Summary
- 원인: spec §2. 서버 도착 전에도 회원 링이 로컬 상태만으로 "측정하는 중"을 단정.
- 변경: `frontend/src/lib/class/member-player-case.ts`, `.../member/MemberStage.tsx`, `.../member/MemberClassContainer.tsx`, 시험 `frontend/tests/sdd295-member-ring-server-confirm.test.ts`.
- 시험: 신규 4건 통과(수정 전 3건 실패=RED 확인). `tsc -b` 0. member 관련 vitest 17파일 중 16 통과, 1건(`measure-guard-null-display`)은 수정 전에도 동일 실패(기준선).
- 확인 못 한 것: iOS 실기기 재현. 이 회차에 데이터가 서버에 안 온 근본 이유(네이티브 start 미도달 여부)는 별개 — SDD-293(인계)·297(진단) 범위에서 확인 필요. 전체 vitest 는 시간 초과로 전수 실행 못 함(관련 파일만).
- 앱 재빌드: 웹 번들 변경만이라 불필요(웹 배포로 반영, Capacitor 가 원격 번들이면). 번들 내장형이면 재빌드 필요 — 감독 확인.
