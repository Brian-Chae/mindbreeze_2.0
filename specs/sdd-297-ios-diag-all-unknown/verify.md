# SDD-297 Verify (구현 전 작성)

| ID | 시나리오 | 기대 |
|---|---|---|
| V1 | iOS 형태 snapshot(`archive.queue` 4키 유한) → `uploadPatchFromSnapshot` | featurePending/Acked, rawPending, rawVerified 채워진 patch |
| V2 | snapshot 에 queue 없음/값이 숫자 아님 | null → 스토어 미갱신 → 화면 '확인 전' 유지 |
| V3 | patch 를 스토어에 넣고 `deriveConnectionDiagnostics` | counts 4칸 모두 '확인 전' 아님 |
| V4 | 저장 진행 이벤트가 먼저/나중에 도착 | 이벤트 값이 snapshot 시드보다 우선(덮어씀), 이후 snapshot 이 이벤트 값을 되돌리지 않음 |
| V5 | Android 형태(이벤트 + `bridge` 래핑 snapshot) | 기존 동작 불변 |
| V6 | 훅: 이벤트 0건·snapshot 만 오는 iOS 모의 → `diagnostics.upload` | null 이 아님 |
| V7 | 스토어 갱신만 있고 다른 상태 변화 없음 | 훅이 재렌더되어 diagnostics.upload 갱신 |
| V8 | 회귀 | `tsc -b` 0, `sdd284-connection-diagnostics` 23건 통과, `sdd260-web` 통과, 신규 실패 0 |
| V9 | 실기기(iOS 빌드 2) | **못 함** — 감독 설치 후 확인. 진단 줄 값 + `diagPath` |
