# SDD-235 구현 계획

## FE — 승인된 A안 (2026-10-22)
Brian의 10/22 확정 및 구현 지시를 승인 근거로 한다. BE 절은 별도 워커가 관리한다.

1. 모바일 도크 위 76px 상시 신호 줄, 데스크톱 상단 진입점, 독립 손들기·익명 신호 시트를 연결한다. 0건도 활성 버튼이며 흐리게 표시한다. 기존 도크 5개 유지, 밴드 미착용 타일에도 손들기·발언권 표시.
2. 손 내리기는 기존 lower-hand API를 사용하고 처리 중 중복 방지·실패 안내를 제공한다. 백엔드는 수정하지 않는다.
3. 순수 이벤트 정책과 호스트 토스트를 구현한다. 핵심 3종만 무음, 종류별 묶음, 한 장, 4~6초, 시트 진입. 초기 스냅샷·중복·만료·동일 주제 시트·세션 전환을 검증한다. 조용한 신호에는 이름을 전달하지 않는다.
4. 신규 vitest RED→GREEN 및 기존 host 회귀, 타입·변경 파일 eslint·build를 실행한다.
5. Chrome 실제 HostLiveView 하니스에서 390/1440 상태별 캡처, 독립 리뷰, summary 작성 및 기능 브랜치 푸시. PR·배포 없음.

### FE 파일 책임
- UI: HostLiveView, HostParticipantGrid, host-player.css, sheets, host-player-case.
- 이벤트: HostLiveContainer, quiet-signal 및 새 호스트 토스트 정책/훅.
- 검증: 기존 host 테스트 하니스 확장, 신규 테스트 및 screens.
