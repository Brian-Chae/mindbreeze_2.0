# 회원 클래스(명상) 진행 화면 — 구현 브리프 (디자인 정본 → React 이식)

## 미션

기존 `frontend/src/components/class/GuestMeditationPanel.tsx`(세로 스크롤 10개 섹션)를, 확정된 디자인 정본 HTML의 **1화면(스크롤 없음) 레이아웃**으로 리팩토링한다.

## 읽어야 할 파일 (정본)

- **디자인 정본**: `design/member-class-player/index.html` (self-contained, 인라인 CSS — 이 파일을 먼저 읽고 디자인 요소를 전부 파악할 것)
- **이식 대상**: `frontend/src/components/class/GuestMeditationPanel.tsx` (704행)
- 참고: `frontend/src/components/class/BrainChart.tsx`, `QuietSignalButtons.tsx`, `GuestAudioPanel.tsx`, `CounselorLiveTile.tsx`

## 핵심 원칙 (반드시 지킬 것)

1. **1화면 수렴, 별도 스크롤 없음** — 데스크탑 1280×720 / 모바일 390×844 어떤 뷰포트에서도 스크롤이 생기면 실패.
2. **디자인 정본을 빠짐없이 옮긴다** — HTML의 시각 요소(6지표 대형 카드 + 12구간 막대그래프 + 타이머 오버레이 + 시그널 3버튼 + BGM 미니바 + 영상 빈 상태 글로우)를 단순화하지 말 것.
3. **6지표 대형 카드는 유지**하고, 카드 하나를 탭하면 그 지표의 **막대 그래프(12구간 평균)**가 갱신된다.
4. **막대 = 최근 구간 평균**으로 차분하게 표시. 1초마다 튀는 값 표시 금지. 마지막 막대는 "지금"으로 강조.
5. **브랜드 토큰**: 퍼플 `#5F0080`, 크림 `#F7F4F0`, 민트 `#01f0c8`. 배경은 보라 자연 이미지 페이드(목업은 CSS 그라디언트 placeholder — 실제 코드에서는 기존 `FadingImageBackground` 유지 + 보라 스크림 오버레이).

## 데이터 계약 — 절대 건드리지 말 것 (표현층만 교체)

- `useBand`, `useSessionLiveSocket`, `useAuthStore`, `scoreIndices`, `useGuestAudioSync`, `useAudioRecorder` 등 모든 훅/계약 유지.
- `METRICS` 6지표 정의(focus/relaxation/emotional/bpm/respiration/hrv + unit + chartMax) 유지.
- 시계열 링버퍼(1Hz, MAX_POINTS=300) 로직 유지 — 단, 표시를 선형 차트에서 12구간 평균 막대로 바꾼다.
- WS 이벤트(`SessionLiveEegFeatureEvent`), 무음 시그널(`liveSocket.sendSignal`), 오디오 동기(`class:audio_sync`) 계약 유지.

## 레이아웃 변경 (기존 → 새)

| 기존 (세로 스크롤) | 새 (1화면) |
|---|---|
| 헤더: 종료 / 제목 / 스피커 | ① topbar 통합: 종료 · 제목 · 음소거 · 화면끄기(⏻) |
| 상담사 영상 (max-w-4xl) | ② 영상 타일 (데스크탑: 좌측 컬럼, 타이머를 영상 좌하단 오버레이로) |
| 진행시간 (별도 섹션) | ⤷ 타이머 오버레이로 이동 |
| 6지표 그리드 (2/3/6열) | ③ 우측 컬럼 3열×2행 대형 카드 |
| 시계열 선형 차트 (BrainChart) | ④ **12구간 막대 그래프** (탭한 지표만, 카드 아래) |
| 상태 힌트 1줄 | ⤷ 지표 헤더 / 영상 하단으로 통합 |
| 무음 시그널 3버튼 | ⑤ 유지 (우측 하단) |
| BGM 패널 (볼륨 슬라이더) | ⑥ 미니바 (트랙명 + 동기상태, 볼륨은 팝업) |
| 밴드 연결 4줄 + 버튼 | ⤷ 상태 점(아이콘)만, 미연결 시에만 버튼 |
| 화면 끄기 FAB (우하단) | ⤷ topbar 버튼(⏻)으로 이동 |

- **데스크탑**: 좌(영상 1.5fr) / 우(지표+차트+시그널+BGM 1fr) 2단 그리드.
- **모바일**: 영상(축소, min 180px) + 지표 카드 + 막대그래프 + 시그널 + BGM 세로 컴팩트.

## 막대 그래프 로직 (핵심)

- 시계열 링버퍼(최대 300포인트 = 5분)를 **12구간(각 25초)**으로 나눠 각 구간 평균을 막대 높이로 표시.
- 마지막 구간 = "지금" 막대 → 민트→퍼플 그라디언트로 강조 (`linear-gradient(180deg, #01f0c8 0%, #a855f7 70%, #7b2a9e 100%)`), 나머지 막대는 낮은 불투명도로 상대 강조 복원.
- 막대 폭 ~20px, 12구간. axis 좌 "5분 전" / 우 "지금".
- 차트 헤더: "`{지표명}` · 시간 변화" + 우측 현재값(또는 추세).
- 데이터가 없으면(밴드 미연결): "지표 차트는 LINK BAND 연결 후 표시됩니다" 유지.

## 타이포 / 터치 타깃

- 폰트 7단 정규화: 10 / 11 / 13 / 15 / 21 / 26 / 38px (0.5px 단위·9px대 금지).
- 터치 타깃: 버튼 높이 44px 이상.
- BGM "동기 재생 중" 배지: 민트 토큰 + pulse 애니메이션(`prefers-reduced-motion` 가드).

## 유지해야 할 기존 기능 (삭제 금지)

- **화면 끄기(몰입)**: 검정 오버레이 + 타이머 + [화면 켜기] — 단, 토글 위치는 topbar로 이동.
- **클래스 채팅** (`ClassChatPanel`, `chat_enabled` 게이트, 안읽음 배지).
- **게스트 채팅 안내** (`GuestChatNotice`).
- **온보딩 코치마크** (`ClassOnboardingCoachmarks`).
- **리드오프 모달** (`LeadOffModal`) + "AI 분석중" 표시.
- **오디오 동기 재생**(BGM/가이드) — 몰입 중에도 재생 유지.
- **무음 시그널** (`QuietSignalButtons`) — 상담사에게만 전달.
- **오프라인 그룹 >20명**: 상담사 영상 타일 숨김(강당형) 유지.
- **오프라인 기본 뮤트 / 온라인 기본 ON** 스피커 로직 유지.

## 함정 (반드시 주의)

1. Tailwind 클래스를 템플릿 리터럴로 합성해 bg 충돌 금지 — 버튼은 별도 클래스 문자열로 (`bg-white/20 text-white` + 악센트 `bg-[#5F0080]` 합성 금지).
2. `any` 타입 금지, 명시적 인터페이스 사용.
3. 불변성: 객체 직접 변경 금지, 복사 후 수정.
4. BrainChart(선형)는 다른 곳에서도 쓰이므로 삭제하지 말고, 이 패널에서만 새 막대 그래프 컴포넌트로 대체.
5. `useEffect` 클린업, 타이머 정리 유지.

## 검증 (완료 조건)

1. `cd frontend && npm run build` 통과 (tsc + vite).
2. `cd frontend && npx vitest run` 기존 테스트 통과 (관련 테스트 깨뜨리지 않기).
3. 데스크탑 1280×720 / 모바일 390×844에서 스크롤 없이 수렴하는지 확인.

## 산출물

- `frontend/src/components/class/GuestMeditationPanel.tsx` 수정.
- 필요 시 신규 막대 그래프 컴포넌트(예: `frontend/src/components/class/MetricBarChart.tsx`) 추가.

어떤 선택지·확인 질문도 던지지 말 것. Brian은 방향을 확정했다. 네 판단으로 끝까지 구현하고, 진짜 막히는 것만 미해결 섹션에 기록해라. 구현 완료 후 worker_done으로 보고하라.
