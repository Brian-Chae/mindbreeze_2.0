# SDD-299 — 구현 요약

## 변경 (배치만 이동, 기능 추가·삭제 없음)
| 항목 | 내용 |
|---|---|
| 독 라벨 | 온라인 분석·채팅·미디어·설정 / 오프라인 분석·채팅·녹음·설정. `host-player-case.ts` 의 `hostDockLabels()` 한 곳에서 정의, 내부 시트 키(metric/chat/media/tools)는 유지 |
| 분석 시트 | 구 지표 기준 + 회원 정렬 + 손든 회원 우선(온라인 그룹만) + 표로 보기. 부제 "실시간 표시 방식" |
| 미디어/녹음 시트 | 구 설정의 미디어 구역(`HostMediaSheet` 직접 사용). 오프라인은 카메라·마이크 토글·전후면 전환 없음. 정원 구역은 제거(설정으로 이동) |
| 설정 시트 | 첫 구역 정원 늘리기(제목 옆 "최대 50명/100명") → 참여 안내(입장 코드) → 회원 초대 → 내 밴드 → 화면 이동. 모든 구역 제목 15px/600/22px(`HostSection title`) |
| 아이콘 | 미디어=Video, 녹음=Mic, 설정=Settings |
| 보존 | `CapacityIncreaseForm` 로직·API·props 무변경(위치만), 칩의 녹음 → media 시트 연결, 허용 방법 시트, 채팅 안 읽음 뱃지 |
| 하니스 | `HostCaseHarness` 에 capacity 픽스처 추가(설정 시트 렌더 확인용) |

## 시험
- 갱신(삭제 없음): host-settings-dock, host-tools-exit, class-flow-host-member-invite, class-player-host-{sheets,view,container,detail}
- 신규: `tests/sdd299-host-menu-reorg.test.tsx` 13건(독 라벨 온/오프, 구 라벨 0건, 시트별 기능, 정원 첫 구역·상한, 오프라인 카메라류 숨김)
- 대상 13파일 221건 통과, `tsc -b` 0
- 전체 vitest: 구현 후 24건/14파일 실패 중 1건(host-detail 오프라인 독 기대값)이 새 구조에 맞춰 갱신 필요한 것이었고 갱신 후 대상 시험 통과. 나머지 23건/13파일은 기준선 실패와 동일 계열(agent-counselor-page, nav-*, org-management-browser, measure-guard-null-display 등 상담사 화면과 무관). 갱신 후 전체 재실행은 하지 않음.

## 렌더 확인 (390/768, 하니스 `/design/class-player`)
`impl-online-dock-390.png`, `impl-offline-dock-390.png`, `impl-online-settings-390.png`, `impl-online-settings-scroll-390.png`, `impl-offline-settings-390.png`, `impl-online-analysis-390.png`, `impl-online-media-390.png`, `impl-offline-media-390.png`, `impl-online-settings-768.png`, `impl-offline-dock-768.png`
- 가로 넘침 0(전 케이스), 시트 내 44px 미만 버튼 0, 독 4개 폭 86px(390)/176px(768)
- 설정 구역 제목 4종(회원 초대는 초대 콜백이 있을 때만) 모두 15px/600/22px

## 시안 v3 와 차이
- 하니스 독 높이 50px(시안 60px/64px): 기존 `PlayerDock` 토큰을 그대로 둠(공통 컴포넌트라 변경 안 함)
- 설정 시트 하단 고정 제출 버튼(`sheet-foot`) 없음: 기존 폼 내부 버튼 유지(로직 수정 금지)
- 정원 카드 안에 폼의 자체 제목 "정원 늘리기"가 한 번 더 보임(폼 내부 문구, 로직 파일이라 미변경)
- 시안의 성공/충돌 결과 카드는 기존 폼 문구 그대로

## 확인 못 한 것
- 실기기 안전영역·키보드, 앱(iOS/Android) 번들 반영 — 웹 번들 내장이라 앱 재빌드 필요
- 전체 vitest 갱신 후 재실행
