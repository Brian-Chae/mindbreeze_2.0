# SDD-268 verify (구현 전)
| ID | 시나리오 | 기대 |
|---|---|---|
| V-N01 | 초기 렌더, 업로드 중(pending>0) | 안내 없음 |
| V-N02 | 연결 아이콘 1회 탭 | 안내 표시, aria-expanded=true |
| V-N03 | 다시 탭 | 안내 숨김, aria-expanded=false |
| V-N04 | needs_review(격리·거절>0) | 탭 없이 표시 |
| V-N05 | needs_review 상태에서 아이콘 탭 | 계속 표시(이상은 숨길 수 없음) |
| V-N06 | 안내 문구 | feature/원시/업로드 날것 0건, '분석 데이터'·'측정 기록 파일' 사용 |
| V-N07 | 업로드 없음(progress null) | 탭해도 표시할 것 없음(렌더 null) |
| V-N08 | 아이콘 접근성 | button, aria-label 유지, 키보드 Enter/Space |
| V-N09 | 기존 회원 클래스 시험(class-player-member-container 등) | 회귀 0 |
| V-N10 | 390px 상단 바 | 레이아웃 변화·가로 넘침 0 |
