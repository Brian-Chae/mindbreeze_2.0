# 02 — 게스트 명상 플로우 디자인 포팅 기획

> SDD-029 / 1.0 Design Parity  
> 범위: 게스트(참가자) `waiting → meditation → complete` 화면을 1.0과 **동일한 시각 결과**가 나오도록 2.0 웹에 반응형 포팅.  
> 본 문서는 **기획 전용**이며 코드 수정 금지.  
> 근거 소스: `mind-breeze-app` Guest*Screen + `mindbreeze_2.0` `class-join-page.tsx` / `GuestMeditationPanel.tsx`

---

## 브랜드 토큰 (1.0 원천 — 필수 반영)

| 토큰 | Hex | 1.0 상수 | 용도 |
|------|-----|----------|------|
| Black | `#000000` | `Color.C000000` | 대기·명상 화면 베이스 배경 |
| White | `#FFFFFF` | `Color.CFFFFFF` | 본문/초대형 숫자·타이머 |
| White 90% | `#FFFFFFE6` | `Color.CFFFFFFE6` | Outro 대기 문구 |
| White 80% | `#FFFFFFCC` | `Color.CFFFFFFCC` | 헤더 세션명 |
| White 70% | `#FFFFFFB2` | `Color.CFFFFFFB2` | LeadOff 설명문 |
| White 60% | `#FFFFFF99` | `Color.CFFFFFF99` | 화면 끄기 모드 타이머 |
| White 20% | `#FFFFFF33` | `Color.CFFFFFF33` | 「종료」버튼 배경 |
| Brand Purple | `#5F0080` | `Color.C5F0080` | 1차 CTA (착용했어요 / 동의 / 제출) |
| Accent Purple | `#B373EF` | `Color.CB373EF` | 완료 화면 보조 문구 |
| Soft Lavender | `#F5EDFC` | `Color.CF5EDFC` | 완료·동의 화면 배경 |
| Header title (명상) | `#F2F3F8` | `Color.CF2F3F8` | 명상 헤더 실명 |
| Chart high | `#D9D9D9CC` | (인라인) | BrainChart bar > 40 |
| Chart low | `#D9D9D933` | (인라인) | BrainChart bar ≤ 40 |

근거: `mind-breeze-app/src/constants/Color.ts`, `GuestMeditationScreen/BrainChart.tsx`.

**금지(현 2.0 이탈)**: `#1A0B2E` / `#2D1045→#5F0080` 그라데이션 카드, cyan sparkline, 밝은 `#F8F6FA` 카드형 waiting. 명상·대기 immersive 구간은 **검정 풀블리드**가 정본이다.

---

## 대기 화면 디자인 매핑

### 1.0 구조 (정본)

`GuestWaitingScreen`은 **검정 풀스크린 + intro 영상 루프** 위에 3-step 오버레이를 올린다.

| 요소 | 1.0 구현 | 시각 스펙 |
|------|----------|-----------|
| 배경 | `backgroundColor={Color.C000000}` + `Video` `background_intro.mp4` absoluteFill, muted/repeat/cover | 검정 베이스, 영상이 전체면 |
| 헤더 | transparent, 좌「종료」(`#FFFFFF33` bg / `#FFFFFF` text), 중앙 세션명(`#FFFFFFCC`), 우 SeatNumberBand | 유리형 오버레이 헤더 |
| Step 1 `WelcomeText` | `Text28B` `#FFFFFF`, 페이드 2초×2, 진입 지연 4초, 완료 후 3초 대기 | 환영 → LINK BAND 안내 |
| Step 2 `VideoViewModal` | Modal 100% 폭, 좌 2: 우 1 레이아웃, `band_guide.mp4`, `SensorTrackerContainer`, CTA `backgroundColor={Color.C5F0080}` 「LINK BAND를 착용했어요.」 | 브랜드 보라 CTA |
| Step 3 `OutroText` | `Text28B` `#FFFFFFE6` 「잠시 후 클래스가 시작…」, SensorTracker, 실명/성별/생년월일/연락처 | 대기 상태 유지 |

근거: `GuestWaitingScreen/index.tsx` L93–126, `WelcomeText.tsx`, `VideoViewModal.tsx`, `OutroText.tsx`.

### 2.0 현황 (갭)

`class-join-page.tsx` `step === 'waiting'`는 **밝은 카드 UI**다.

- 배경 `#F8F6FA`, 흰 카드, 보라 eyebrow
- 클래스 코드를 mono 대형 표시
- 「호스트가 시작할 때까지…」문구만 존재
- intro 영상 / Welcome 페이드 / 착용 가이드 모달 / SensorTracker / Outro **전부 없음**

근거: `frontend/src/pages/class-join-page.tsx` L430–447.

### 포팅 매핑 (waiting)

| 1.0 | 2.0 목표 | 반응형 메모 |
|-----|----------|-------------|
| 검정+intro.mp4 | `waiting` 진입 시 풀뷰포트 `#000`, `<video>` cover 루프 (자산: `background_intro.mp4` 이식) | 모바일도 cover; `prefers-reduced-motion` 시 정지 프레임/포스터 |
| WelcomeText | CSS/Framer 페이드: 문구1 → 문구2 → 가이드 단계 | 폰트: desktop `28px/40px/600`, mobile `20–22px`로 축소하되 **흰 텍스트·중앙 정렬** 유지 |
| VideoViewModal | 웹 모달: 가로≥1024는 2:1 분할(영상|가이드), <1024는 세로 스택(영상 상단 16:9 → 가이드) | CTA `#5F0080` full-width, 흰 카피 |
| SensorTracker | 2.0 `useBand` contact/SQI를 LED 그리드로 시각화 (1.0 SensorTrackerContainer 패리티) | waiting Step2·3·LeadOff 공통 컴포넌트 |
| OutroText | 호스트 시작 대기 카피 + (옵트인) 참가자 표시명. 성별/생년월일/연락처는 2.0 게스트가 이름만 받으므로 **표시명은 유지, 상세 PII는 로그인 사용자만** | 코드 대형 표시는 1.0에 없음 → **보조 정보로 축소**하거나 Outro 하단 subtle |
| 「종료」 | 투명 헤더 좌측, `#FFFFFF33` pill | 터치 44px 이상 |

**상태 전이 트리거(유지)**: 2.0 폴링 `status === 'in_progress' || guest_state === 'meditation'` → `setStep('meditation')` (`class-join-page.tsx` L116–118). UX만 교체, 상태 머신은 SDD-021 계약 유지.

---

## 명상 화면 디자인 매핑 (핵심)

### 1.0 구조 (정본) — “동일한 화면”의 중심

`GuestMeditationScreen` 핵심 레이아웃:

```
[검정 풀스크린]
  └ FadingImageBackground (background1~10.jpg, 20s 교체, 1s 크로스페이드)
       ├ flex 1 spacer
       ├ Row flex 3
       │    ├ Center: 「진행시간」(Text38B white 0.6) + Timer Text130B
       │    └ Center: 「두뇌휴식도」(Text38B white 0.6) + Text130B `{n}%` 또는 BlinkingText「AI 분석중」
       └ Center flex 3: BrainChart (bar 14×높이, gap 12, fill #D9D9D9CC / #D9D9D933)
```

추가 UX:

| 요소 | 스펙 |
|------|------|
| 타이포 | 라벨 `38px/48px/600` opacity 0.6; 수치·타이머 `130px/182px/600` `#FFFFFF` |
| AI 분석중 | LeadOff 해소 후 15초 `isAnalyzingRef`; `BlinkingText` fontSize 70 / lineHeight 100, opacity 1↔0.1, 3s 왕복 |
| LeadOffModal | 「LINK BAND 위치를 조정해주세요」+ SensorTracker + 「무시하기」; 접촉 불량 시 자동 표시 |
| 화면 끄기 | 우하단 토글; 1500ms opacity crossfade; 끄면 타이머만 (`#FFFFFF99`) |
| 종료 확인 | TwoButtonsModal 「정말 종료할까요? / 지금 종료하면 리포트를 받아볼 수 없어요.」 |
| 헤더 | 종료 pill, 실명 `#F2F3F8`, SeatNumberBand, transparent |

근거: `GuestMeditationScreen/index.tsx` L175–263, `Timer.tsx`, `BrainChart.tsx`, `LeadOffModal.tsx`, `FadingImageBackground.tsx`, `BlinkingText.tsx`, `Texts.tsx` Text130/38.

### 2.0 현황 (갭)

`GuestMeditationPanel` + meditation 래퍼:

- 래퍼 `#1A0B2E`, 패널 **보라 그라데이션 카드** (`from-[#2D1045] to-[#5F0080]`), `rounded-3xl`
- 두뇌휴식도 `text-6xl/7xl` (≈60–72px) — **130px 대비 절반 이하**
- 타이머는 헤더 mono `mm:ss / target` — 1.0의 **초대형 단독 타이머 컬럼 없음**
- 차트: cyan sparkline, dashed border shell — 1.0 **회색 둥근 막대 바차트 아님**
- LeadOff는 인라인 문구만 — **풀스크린 LeadOffModal 없음**
- 「AI 분석중」BlinkingText **없음**
- FadingImageBackground **없음**
- 「화면 끄기」**없음**
- 밴드 상태 aside 카드(연결/배터리/접촉/SQI) — 1.0 명상 본화면에는 없고 LeadOff/대기 SensorTracker로 분리

근거: `GuestMeditationPanel.tsx` L108–249, `class-join-page.tsx` L274–294.

### 포팅 매핑 (meditation)

| 1.0 | 2.0 목표 | 비고 |
|-----|----------|------|
| `#000` + FadingImage | 풀뷰포트 검정, `background1~10` 자산 이식, 20s/1s 크로스페이드 유틸 | 카드/그라데이션 제거. max-w-5xl 래퍼 제거 → immersive |
| 2컬럼 초대형 수치 | Desktop: 좌 Timer / 우 두뇌휴식도 각 `clamp(64px, 12vw, 130px)` | `%` 접미사 1.0과 동일 유지 |
| BrainChart | SVG bar: width 14, spacing 12, rx=7, threshold 40, colors 위 토큰 | 데이터: 기존 `band.chartPoints` → relaxation % 배열로 매핑 |
| BlinkingText | LeadOff→양호 전이 후 15초 「AI 분석중」 | `deviceStatus`/`lead_off` 해소 시점과 연동 |
| LeadOffModal | 풀스크린/대형 모달 + SensorTracker + 무시하기 | 현재 인라인 경고를 모달로 승격. 밴드 aside의 상세 상태는 모달·헤더 아이콘으로 이전 가능 |
| 화면 끄기 | absolute 우하단, 1.5s fade | 태블릿 교실 밝기 배려 |
| 나가기 | 1.0 「종료」+ 확인 모달 카피 패리티 | 현재 underline 「나가기」교체 |

**데이터 계약(디자인 외, 유지)**: `useBand` + WS `eeg_feature`는 SDD-023/024/026 유지. 본 기획은 **표현층 패리티**만 강제한다.

---

## 완료 화면 디자인 매핑

### 1.0 구조 (정본)

`GuestCompleteScreen`은 **연보라 `#F5EDFC` 풀페이지**, 세로 스냅 2페이지.

| 페이지 | 내용 |
|--------|------|
| 1 | `Text24` 종료+리포트 안내 → `Text16` `#B373EF` 발송 안내(영업일 1~2일) → `InfiniteScrollingImages` (208×368, 6장 루프, 장당 3초) → CTA「리포트 받아보기」 |
| 2 | `Phone` 3분할 입력(3-4-4) →「제출하기」`#5F0080` 계열 기본 버튼 → 확인/성공 모달 |

헤더: 종료, 실명, SeatNumberBand transparent.  
모달: 조기 종료 경고(리포트 불가), 번호 확인, 신청 완료.

근거: `GuestCompleteScreen/index.tsx`, `Phone.tsx`, `InfiniteScrollingImages.tsx`.

### 2.0 현황 (갭)

- `#F8F6FA` + 흰 카드, 「수업이 종료되었습니다」+ 홈 링크만
- 리포트 샘플 캐러셀·전화번호 신청·확인/성공 모달 **없음**
- 카피도 「상담사가 발급하면 확인」으로 1.0 SMS 리포트 플로우와 다름

근거: `class-join-page.tsx` L297–331.

### 포팅 매핑 (complete)

| 1.0 | 2.0 목표 | 결정 의존 |
|-----|----------|-----------|
| `#F5EDFC` 풀배경 | complete 단계 배경색 교체, 카드 그림자 최소화(1.0은 카드 없음) | — |
| 리포트 샘플 마퀴 | `report_sample_1~6.png` 이식 + CSS/JS infinite scroll | 자산 라이선스/용량 OK 가정 |
| 전화 입력 | 웹: 단일 `tel` 또는 3칸 자동포커스; CTA `#5F0080` | **API**: `report-request` 미구현 시 UI 스텁 vs 숨김 — 아래 리스크 |
| 성공 모달 | 1.0 카피 패리티 후 홈/종료 | SDD-021 게스트 리포트 계약과 정합 |
| 로그인 사용자 | 1.0은 전원 전화 신청; 2.0은 내담자 리포트함 링크 병행 가능 | Product 결정 |

동의 화면(`GuestConsentScreen`)은 본 태스크 1차 범위 밖이나, 동일 토큰(`#F5EDFC`, `#B373EF`, `#5F0080`, `#8655BA`)을 쓰므로 **코드→details 구간 브랜드 정렬 시 참고**.

---

## 상태 전이 연출

| 전이 | 1.0 | 2.0 목표 연출 |
|------|-----|----------------|
| details → waiting | 네비게이션 즉시, intro 영상 상시 | 배경 `#000` crossfade 400–600ms + video fade-in |
| waiting Step1→2 | Welcome 페이드 완료 후 Modal `animationTiming={1000}` | 1s opacity/scale 모달 |
| waiting Step2→3 | CTA 후 Outro 페이드 2s×2 | 동일 |
| waiting → meditation | `sessionLogState === STARTED` 후 100ms navigate | 호스트 시작 감지 시 **검정 유지**, Outro → 명상 배경 이미지로 800–1200ms 크로스페이드 (흰 플래시 금지) |
| meditation → complete | `!isStarted` → GuestComplete | `#000` → `#F5EDFC` 800ms 배경 틴트 페이드 + 완료 카피 fade-in |
| LeadOff on/off | 모달 토글; 해소 후 15s AI 분석중 | 동일 타이밍 |
| 화면 끄기 | 1500ms opacity swap | 동일 |

원칙: **대기·명상 구간은 항상 어두운 톤 유지**. 2.0의 밝은 카드 waiting이 명상으로 튀면 교실 몰입이 깨지므로, waiting부터 immersive black으로 맞춘다.

---

## 반응형 처리

1.0은 태블릿/키오스크형 RN 앱(가로·대형 타이포) 전제. 2.0 웹은 phone / tablet / desktop 동시.

| Breakpoint | waiting | meditation | complete |
|------------|---------|------------|----------|
| ≥1280px | 1.0에 가장 근접: Welcome 28px, VideoView 2:1 | Timer‖휴식도 130px, Chart 248+ 폭 | padding 수평 ~264px 상당(`px-16`~`max-w-4xl`) |
| 768–1279 | Welcome 22–24px; VideoView 스택 | 수치 `clamp(72px, 10vw, 110px)`; Timer/휴식도 2열 유지 가능하면 유지 | 마퀴 이미지 높이 280 |
| <768 | Welcome 18–20px 2줄; 가이드 풀폭 | **세로 스택**: 진행시간 → 두뇌휴식도 → Chart; 수치 min 56–64px (130 고정은 줄바꿈·오버플로) | 마퀴 높이 220, CTA full-width; 전화 3칸 유지 |

공통:

- `safe-area-inset` 헤더/하단 버튼
- `dvh` 풀스크린 (모바일 주소창)
- `prefers-reduced-motion: reduce` → 페이드 duration 0, 배경 이미지 고정 1장, 마퀴 정지
- Web Bluetooth 미지원 브라우저: waiting Step2에서 연결 CTA 대신 안내(Chrome/Edge) — 기능 가드는 기존 규칙, **화면 골격은 동일**

---

## 리스크/결정 포인트

1. **자산 이식**  
   `background_intro.mp4`, `band_guide.mp4`, `background1~10.jpg`, `report_sample_1~6.png`를 2.0 `frontend/public` 또는 CDN으로 옮길지. 용량·캐시·라이선스 확인 필요. 미이식 시 동일 화면 불가.

2. **초대형 130px vs 모바일 가독성**  
   “동일한 화면”을 **시각 비율 패리티**(desktop/tablet 우선)로 둘지, **모든 뷰포트 130px 고정**으로 둘지. 권고: desktop/tablet 130 패리티, phone은 clamp 하한.

3. **게스트 리포트 전화 신청 API**  
   1.0 Complete의 핵심 CTA. 2.0 백엔드 `report-request` / SMS 발송이 없으면 UI만 포팅 시 dead-end.  
   결정: (A) API 선행 (B) UI+대기 카피 (C) 로그인 사용자만 리포트함 링크, 게스트는 감사 화면만.

4. **SensorTracker / SeatNumber**  
   1.0 waiting·LeadOff에 SensorTracker·자리번호 UI가 있음. 2.0은 BLE contact/SQI는 있으나 LED 그리드 컴포넌트·자리번호 UX가 다름. 디자인 패리티에 SensorTracker 재현을 **필수**로 할지, 상태 텍스트로 대체할지 결정.

5. **waiting 3-step vs 즉시 Outro**  
   교실에서 밴드 착용 가이드 영상은 운영상 중요. 웹 자동재생 정책(muted 필수)·사용자 gesture로 Step2 진입 필요할 수 있음. Welcome 자동 진행 타이밍(4+2+2+3초) 유지 여부.

6. **명상 패널의 밴드 aside**  
   2.0이 추가한 연결/배터리 카드는 1.0 본화면과 다름. 패리티 우선 시 숨기고 LeadOff·헤더로만 노출 vs 2.0 운영 가시성 유지(예: 「화면 끄기」옆 접이식).

7. **코드/details 단계 브랜드**  
   본 문서는 waiting부터 complete. code/details가 `#F8F6FA` 카드면 진입 직전 톤이 어긋남. Consent(`#F5EDFC`+`#5F0080`)와 정렬할지 후속 스펙.

8. **구현 경계**  
   본 산출물은 기획만. 구현은 `GuestWaitingPanel` / `GuestMeditationPanel` 재디자인 / `GuestCompletePanel` 분리(SDD-021 리뷰에서 이미 제안)로 이어가면 됨. 상태 폴링·WS·BLE 로직은 시각 교체와 분리.

---

## 부록 — 파일 근거 인덱스

| 구분 | 경로 |
|------|------|
| 1.0 waiting | `mind-breeze-app/src/screens/GuestWaitingScreen/{index,WelcomeText,OutroText,VideoViewModal}.tsx` |
| 1.0 meditation | `mind-breeze-app/src/screens/GuestMeditationScreen/{index,BrainChart,Timer,LeadOffModal}.tsx` |
| 1.0 complete | `mind-breeze-app/src/screens/GuestCompleteScreen/{index,Phone,InfiniteScrollingImages}.tsx` |
| 1.0 consent(참고) | `mind-breeze-app/src/screens/GuestConsentScreen/index.tsx` |
| 1.0 토큰 | `mind-breeze-app/src/constants/Color.ts`, `components/{Texts,FadingImageBackground,BlinkingText}.tsx` |
| 2.0 join FSM | `mindbreeze_2.0/frontend/src/pages/class-join-page.tsx` |
| 2.0 meditation UI | `mindbreeze_2.0/frontend/src/components/class/GuestMeditationPanel.tsx` |

---

*작성: Orca worker · task_7d8004eb18c9 · 코드 수정 없음 · 기획 문서만*
