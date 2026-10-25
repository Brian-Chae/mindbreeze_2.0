# SDD-245 페이지 헤더 보완 — 구현 전 검증 계획

사용자의 2026-10-25 요청을 설계·구현·커밋·푸시·PR 승인으로 적용한다. 머지·배포·서버·DB·메일·삭제는 금지한다.

## 원인과 구현 계획
- 기존 PageHeading과 개별 헤더는 액션 규격·순서·줄바꿈 계약을 소유하지 않는다. 기존 감사도 제목/본문 시작선 위주다.
- PageHeader 정본: 선택 오버라인, 제목 22px/700, 액션 오른쪽·세로 중앙. 좁으면 다음 줄 같은 폭.
- 헤더 sm 44px 고정. primary 진보라 pill, secondary 흰색+보라 테두리 pill. buttonClass 색/hover 재사용. 보조→주 순서, 새 클래스=주/지금 바로 시작=보조. 문구·기능 유지.
- AppShell 역할별 전체 라우트 헤더 inventory 후 공용 이관. 로그인·몰입 플레이어 제외. 필터 tab/field도 검사.

## 검증 체크리스트
- [ ] 공용 헤더 native 동작·44px·순서·반응형 계약 테스트 RED→GREEN.
- [ ] grep으로 전체 AppShell 라우트와 헤더 매핑, 이관 개수·제외 사유 기록.
- [ ] 기존 측정 도구 확장: 액션 높이/radius/배경/테두리/순서/제목 대비 세로 위치, 390·1440 전수 측정.
- [ ] 홈·클래스·리포트 390 전후 나란히 캡처 저장·직접 열어 확인.
- [ ] vitest 전체: 기존 8파일 17건 외 신규 실패 0.
- [ ] tsc --noEmit -p tsconfig.app.json / eslint src/ / npm run build.
- [ ] specs/sdd-234 변경 0, node_modules 심볼릭 미커밋.
- [ ] 독립 diff·검증 리뷰 후 summary, 커밋·push·develop PR·CI pass 확인.
