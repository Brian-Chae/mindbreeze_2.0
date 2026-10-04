# [SDD-123] 구현 계획

정본: `design/member-class-player/design-update-plan.md` (구현 전 갱신 선행 — 정본→구현 순서)

## Task 분해 (표현층만 교체, 데이터 계약 불변)

### T1. 디자인 정본 갱신 (`design/member-class-player/index.html`)
- self-contained HTML에 보라 틴트 토큰 + MIND/BODY 다이얼 + 히어로/서브 + 5분 막대 그래프 반영.
- 모바일(390×844)은 그래프 제거. 데스크톱(1280×720) 무스크롤.

### T2. CSS 토큰 이전 (`member-class-player.css`)
- `:root` 커스텀 프로퍼티 재정의: `--bg:#12081C`, `--surface-1:#1D1027`, `--surface-2:#231531`, `--surface-float:#21132B`, `--selected-bg:#2B1637`, `--selected-border:#B78CCA`, `--lavender:#DCB5EE`, `--muted:#BCAEC5`, `--border-container:#FFFFFF1A`, `--border-divider:#FFFFFF0D`, `--fill:#FFFFFF06`.
- 난립 색상 치환 → 토큰. radius 12px 통일(무음 시그널 pill 999만 예외). 600→500.
- 민트 의미 한정: 포커스 링·bar gradient·axis → 라벤더/퍼플로, dot 계열만 민트 유지.
- `.player-right` 반투명 → 불투명 `#1D1027`. `overflow-y:auto` → 데스크톱 `overflow:hidden`.

### T3. 다이얼 컴포넌트 (신규 또는 인라인)
- `HostMetricDisplay`의 아크 링 로직 이식: viewBox `0 0 120 120`, `r=51`, 그라디언트 `#5F0080→#A16BBC→#D4B5E3`, `pathLength=100`, `strokeDasharray`, round cap, `useId()` id.
- 히어로(84px) / 서브(44px). 중앙 숫자+단위 세로 스택.
- null → 트랙만 + `—`.
- 값 소스 = `snapshot`(1Hz) 직접. 25초 버킷 지연 없음.

### T4. GuestMeditationPanel 지표 블록 교체
- MIND(마음)/BODY(몸) 2섹션, 각 3지표. 히어로 1(선택) + 서브 5. 선택 상태 `--selected-bg`+`--selected-border`(면칠 제거).
- **변화량(직전 1초 대비)**: `seriesRef` 마지막 2포인트 델타. 히어로 하단 `+N · 직전 1초` 표시.
- 선택 인터랙션: 기존 `selectedKey`/`aria-pressed` 유지. 자동 순환 없음.

### T5. 차트 5분 전체 + 데스크톱/모바일 분기 (`metric-bar-chart.tsx`)
- 데스크톱: 지난 5분(1Hz 수집) 전체 구간을 막대 그래프로. 300포인트를 구간 평균(예: 30×10s 또는 60×5s)으로 묶어 표시. 최신 막대 강조.
- 모바일: 차트 렌더 안 함(현재 상태만). CSS 미디어 쿼리 + 조건 렌더.
- `%p` 표기, 평가 문구→관찰 문구.

### T6. 요소별 토큰 적용 (탑바·타이머·밴드·시그널·BGM·채팅·몰입)
- 탑바 `종료`→`나가기`, 채팅 버튼 우측 액션 그룹. 64px 고정.
- 타이머 블러 글래스 + 진행바 3px 라벤더.
- 밴드 상태 1줄 8종 코드.
- 몰입 오버레이 `#12081C`, 타이머 24px.

### T7. 검증
- `npm run build` (tsc+vite) 0 errors.
- `npx vitest run` 기존 테스트 무회귀.
- 브라우저(Playwright) 1280×720 / 390×844 무스크롤 + 44px 버튼 검증.

## 함정 (구현 시 주의)
- 값 소스 `snapshot`(1Hz) 직결 — 25초 버킷 평균 지연 금지(Brian 확정). 막대 그래프만 구간 평균.
- SVG gradient id `useId()` — 하드코딩 시 두 번째 다이얼부터 아크 소실.
- Tailwind 템플릿 리터럴 합성 금지 → 전부 CSS 파일.
- 서브 다이얼 44px → 클릭 영역은 카드 전체(min-height 56px).
- BGM 미니바: `GuestMeditationPanel`에 직접 렌더링 없음 — `GuestAudioPanel`/`LobbyBgmBar` 실제 사용처 확인 후 미노출이면 노출까지.
- HRV 회원=`sdnn` 필드 유지(호스트 `rmssd`와 혼용 금지).
- 링버퍼 결측 시 "최근 5분" 문구는 연속 수신 구간에서만.
