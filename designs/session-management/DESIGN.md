# MIND BREEZE 2.0 — 세션 관리 고도화 · 디자인 시스템

> **방향성**: Dark · Editorial · Clinical-Precise.
> 깊은 자정(near-midnight) 캔버스 위에 브랜드 퍼플(#5F0080)을 *구조적 액센트*로,
> 데이터는 모노스페이스로 *정밀하게*, 위계는 *세리프 디스플레이 + 산세리프 본문*의 타이포로 잡는다.
> 화려함이 아니라 **의도(intentionality)** 로 완성한다.

---

## 1. 디자인 원칙 (Anti-Slop 준수)

| 원칙 | 적용 |
|---|---|
| **타이포 우선** | 위계는 폰트 크기·굵기·자족(font-family)으로 먼저 잡는다. 컬러·아이콘은 보조. |
| **퍼플은 구조로** | `#5F0080`는 그라디언트 장식이 아니라 액티브 상태·포커스 링·라이브 표시 등 *의미*에만. |
| **금지** | glassmorphism(backdrop-blur·bg-white/10), 무지개 그라디언트, 가짜 차트·지표 장식, 스톡 히어로. |
| **데이터 정직성** | EEG 대시보드는 실제 기능. 예시 값은 `샘플 데이터` 배지로 명시. 시각화는 절제(스파크라인·단색 바). |
| **다크 + 절제** | 한 화면에 액센트 컬러는 1~2개. 나머지는 무채색 + 퍼플 톤 그레이. |

---

## 2. 컬러 토큰

### 2.1 캔버스 (다크, 퍼플 언더톤)
```
--bg-0:   #0E0A12   /* 최하단 배경 (near-black, purple undertone) */
--bg-1:   #161019   /* 패널 / 사이드바 */
--bg-2:   #1E1726   /* 카드 (raised) */
--bg-3:   #2A2033   /* 카드 hover / inset */
--bg-elev:#241B2E   /* 모달 / 팝오버 */
```

### 2.2 브랜드 퍼플 스케일
```
--purple-900: #2A0038   /* 딥 틴트 배경 (라이브 패널 등) */
--purple-800: #3D0052
--purple-700: #5F0080   /* ★ 브랜드 Primary */
--purple-600: #7A1AA0
--purple-500: #9333B8   /* 다크 위 버튼/필 */
--purple-400: #B05CD0   /* 다크 위 액센트 텍스트·라인 */
--purple-300: #D29BE8   /* 링크 / 하이라이트 */
--purple-tint:#F5EDFC   /* 라이트 틴트 (극히 제한적 사용) */
```
> 다크 배경에서 `#5F0080`은 본문 텍스트로 쓰기엔 명도가 낮다 → **액센트 텍스트·라인은 `--purple-400`, 면(fill)·버튼은 `--purple-700`** 규칙.

### 2.3 텍스트
```
--text-hi:  #F4F0F7   /* 제목 / 강조 */
--text-mid: #B7AEC2   /* 본문 / 보조 */
--text-lo:  #7C7388   /* 캡션 / 비활성 */
--text-on-purple: #FBF5FF  /* 퍼플 면 위 텍스트 */
```
> (라이트 모드 참고값: 본문 `#1F1F1F`, 보조 `#6F6F6F`, 표면 `#FAFAFA`·`#F5EDFC` — 본 프로토타입은 다크 우선.)

### 2.4 라인 / 디바이더
```
--line:        rgba(244,240,247,0.08)
--line-strong: rgba(244,240,247,0.14)
--line-purple: rgba(176,92,208,0.28)
```

### 2.5 세션 상태 (의미색, 절제)
```
--st-scheduled: #7AA2F7   /* 예정 — 차분한 블루 */
--st-live:      #FF5C7A   /* 진행중 — 라이브/녹음 (warm rose) */
--st-done:      #4FD1A1   /* 완료 — 틸 그린 */
--st-cancelled: #7C7388   /* 취소 — 뮤트 그레이 */
```

### 2.6 세션 유형 (도트/라벨 액센트만)
```
--type-clinical:   #B05CD0   /* 임상심리상담 */
--type-hypnosis:   #7B6CF6   /* 최면심리상담 */
--type-meditation: #3FB6A8   /* 명상수업 */
--type-custom:     #9A93A6   /* 기타(커스텀) */
```

### 2.7 EEG 지표 톤 (무지개 금지 → 3 의미축 + 톤스케일)
```
--eeg-focus:  #B05CD0   /* 집중 계열 (purple) */
--eeg-calm:   #3FB6A8   /* 이완 계열 (teal) */
--eeg-stress: #E0A14B   /* 스트레스/부하 (amber) */
--eeg-signal: #C77DDE   /* Fp1/Fp2 파형 라인 */
--eeg-grid:   rgba(244,240,247,0.06)
```

---

## 3. 타이포그래피

### 3.1 폰트 패밀리 (Inter/Roboto/system 금지)
```
--font-display: "Gowun Batang", serif;        /* 우아한 명조 — 큰 제목·숫자 헤드라인 */
--font-body:    "IBM Plex Sans KR", sans-serif;/* 본문·UI — 기술적이고 명료, 한글 지원 */
--font-mono:    "IBM Plex Mono", monospace;     /* EEG 수치·타임스탬프·코드 */
```
- **Display(세리프)** 는 페이지 타이틀·KPI 숫자 등 "읽히는 순간"에만. 남용 금지.
- **Body(IBM Plex Sans KR)** 가 화면의 90%. 위계는 weight(400/500/600)와 size로.
- **Mono** 는 EEG 값·시각·코드·링크 등 *정밀·고정폭* 데이터 전용.

### 3.2 타입 스케일 (1920×1080 기준, px)
| 토큰 | size / line-height | 용도 | family |
|---|---|---|---|
| `--fs-display` | 44 / 1.1 | 페이지 대제목 | display |
| `--fs-h1` | 30 / 1.2 | 화면 타이틀 | body 600 |
| `--fs-h2` | 22 / 1.3 | 섹션 헤더 | body 600 |
| `--fs-h3` | 17 / 1.35 | 카드 타이틀 | body 600 |
| `--fs-body` | 15 / 1.5 | 본문 | body 400 |
| `--fs-sm` | 13 / 1.45 | 보조·메타 | body 400 |
| `--fs-xs` | 11.5 / 1.4 | 라벨·배지 (UPPER, letter-spacing .08em) | body 600 |
| `--fs-kpi` | 34 / 1 | EEG 큰 수치 | mono 500 |
| `--fs-data` | 14 / 1 | EEG 인라인 값 | mono 500 |

### 3.3 라벨 규칙
- 오버라인/배지: `text-transform: uppercase; letter-spacing: .08em; font-size: var(--fs-xs);`
- 한글 라벨은 uppercase 대신 자간(letter-spacing .02em) + `--text-lo`.

---

## 4. 스페이싱 · 레이아웃

### 4.1 스페이싱 스케일 (4px 베이스)
```
--sp-1:4  --sp-2:8  --sp-3:12  --sp-4:16  --sp-5:24
--sp-6:32 --sp-7:48 --sp-8:64 --sp-9:96
```

### 4.2 반경 (Radius)
```
--r-sm:6  --r-md:10  --r-lg:16  --r-xl:24  --r-pill:999px
```
> 다크·미니멀 → 과한 라운드 금지. 카드 `--r-lg(16)`, 버튼·인풋 `--r-md(10)`, 배지 `--r-pill`.

### 4.3 그림자 / 광채 (다크에서는 절제)
```
--shadow-card: 0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.45);
--shadow-modal:0 24px 64px rgba(0,0,0,0.6);
--glow-live:   0 0 0 1px rgba(255,92,122,0.4), 0 0 20px rgba(255,92,122,0.25);
--glow-focus:  0 0 0 2px rgba(176,92,208,0.55);   /* 포커스 링 */
```

### 4.4 그리드 / 셸
- **AppShell**: 사이드바 `220px` + 메인. 메인 상단 헤더 `64px`.
- 콘텐츠 최대 내부 패딩 `--sp-6(32)`.
- 대시보드 본문: `calendar 1.7fr / agenda 1fr` 2컬럼.
- Live 화면: `video 1.55fr / panel 1fr` 2컬럼.

---

## 5. 컴포넌트 토큰

### 5.1 버튼
| 변형 | 배경 | 텍스트 | 보더 | 비고 |
|---|---|---|---|---|
| Primary | `--purple-700` | `--text-on-purple` | none | 주요 액션(세션 생성·초대 발송) |
| Secondary | transparent | `--text-hi` | `--line-strong` | 보조 |
| Ghost | transparent | `--text-mid` | none | 아이콘/툴바 |
| Danger | transparent | `--st-live` | `1px var(--st-live)` | 세션 종료 |
- 높이: lg 44 / md 36 / sm 30. padding-x: 16~20. radius `--r-md`. font 500.
- hover: 면 +6% 명도 / ghost는 `--bg-3`. focus: `--glow-focus`.

### 5.2 배지 / 칩
- 상태 배지: 도트(6px, 상태색) + 라벨. 배경 `--bg-3`, 텍스트 `--text-mid`, radius pill.
- **라이브 배지**: `--st-live` 도트 + 펄스 애니메이션 + `REC 00:00` 모노 타이머.
- 유형 칩: 좌측 4px 컬러 도트 + 라벨.
- 토글/세그먼트: 트랙 `--bg-3`, 활성 세그먼트 `--purple-700` 면.

### 5.3 카드
- 배경 `--bg-2`, 보더 `1px --line`, radius `--r-lg`, padding `--sp-5`, shadow `--shadow-card`.
- 좌측 액센트 바(3px) = 세션 유형색 (세션 카드 한정).

### 5.4 인풋 / 필드
- 배경 `--bg-1`, 보더 `1px --line-strong`, radius `--r-md`, 높이 40, 텍스트 `--text-hi`, placeholder `--text-lo`.
- focus: 보더 `--purple-400` + `--glow-focus`.
- 라벨: `--fs-sm` `--text-mid`, margin-bottom 6.

### 5.5 세그먼티드 컨트롤 (유형/온오프라인/LINK BAND)
- 컨테이너 `--bg-1`, 보더 `--line`, radius `--r-md`, padding 3.
- 세그먼트 활성: `--purple-700` 면 + `--text-on-purple`. 비활성: `--text-mid`.

### 5.6 EEG 메트릭 셀
- 그리드 셀: 배경 `--bg-1`, 보더 `--line`, radius `--r-md`, padding `--sp-4`.
- 라벨(상단, `--fs-xs` `--text-lo`) → 값(mono `--fs-data`/`--fs-kpi`) → 미니 바/델타.
- 바: 단색(의미축 색) 트랙 `--eeg-grid` 위. 값에 따른 fill. **그라디언트 금지.**

### 5.7 모달
- 백드롭: `rgba(8,5,11,0.72)` (blur 금지 — 단색 디밍).
- 패널: `--bg-elev`, 보더 `--line-strong`, radius `--r-xl`, shadow `--shadow-modal`, max-width 560.
- 탭: 언더라인 인디케이터(`--purple-400`).

### 5.8 캘린더
- 타임 그리드: 행=시간(48px), 열=요일. 그리드 라인 `--line`.
- 세션 블록: 유형색 좌측 바 + `--bg-2` 면 + 시간(mono). 진행중 블록은 `--glow-live` 테두리.
- now-line: `--purple-400` 가로선 + 좌측 점.

---

## 6. 모션

| 상황 | 효과 |
|---|---|
| 슬라이드/페이지 로드 | 상단→하단 staggered reveal (translateY 8px → 0, opacity, `animation-delay` 40ms 간격). |
| 라이브 도트 | `pulse` 1.6s ease-in-out infinite (scale + opacity). |
| EEG 파형 | SVG path `stroke-dashoffset` 흐름(선택) — 저강도. |
| hover | 120ms ease. 면 명도/보더 변화만. |
| 모달 | 백드롭 fade 120ms + 패널 scale(.98→1)·translateY(8→0) 180ms. |
> CSS-only 우선. 과한 마이크로 인터랙션 금지 — *한 번의 잘 짜인 진입 연출*에 집중.

---

## 7. 온/오프라인 × 1:1/1:N × LINK BAND 매트릭스 (UI 규칙)

| 축 | 값 | UI 시그널 |
|---|---|---|
| 연결 | 온라인 | 비디오 영역 활성 (WebRTC 타일) |
| 연결 | 오프라인 Solo | 비디오 영역 *비활성 플레이스홀더* — "Solo 방 · 화상 없음", 녹음+EEG+메모만 |
| 인원 | 1:1 | 단일 비디오 / 단일 EEG 뷰 |
| 인원 | 1:N | SFU 그리드 + 참여자별 EEG 탭 전환 |
| LINK BAND | 미사용 | EEG 패널 자리에 "측정 안 함" 빈 상태 (가드: `if(bandConnected)`) |
| LINK BAND | 필수 | EEG 패널 + 미착용 시 시작 차단 경고 |
| LINK BAND | 선택 | EEG 패널 + 착용 토글, 미착용 시 회색 처리 |

> **공통 레이아웃 유지**: Live(온라인)와 Live(오프라인 Solo)는 *동일 골격* — 비디오 영역의 상태만 다르다. 일관성이 곧 학습 비용 절감.

---

## 8. 접근성 / 구현 노트
- 명암비: 본문 `--text-mid` on `--bg-1` ≥ 4.5:1 충족. 액센트 텍스트는 `--purple-400` 이상만 사용.
- 포커스 가시성: 모든 인터랙션 요소 `--glow-focus`.
- 색만으로 상태 전달 금지: 상태는 도트+라벨, 유형은 도트+텍스트 병기.
- EEG 가드: LINK BAND 미연결/미사용 시 EEG 영역은 빈 상태로 *기능 차단 없이* 진행.
- ComfyUI 배경 자산: 코드 내 `{{COMFYUI_BG}}` 플레이스홀더로 표기(비디오 타일·분위기 배경).
