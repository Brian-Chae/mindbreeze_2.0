# MIND BREEZE 2.0 — DESIGN.md

> **SSOT 디자인 명세.** 모든 UI 구현은 이 문서의 토큰과 컴포넌트 스펙을 기준으로 한다.
> 변경은 `design-system/`에서 토큰 수정 → 빌드 → 이 문서 갱신 순서로 진행.

## 디자인 방향

**Clinical Garden — Dark · Editorial · Clinical-Precise**
깊은 자정(near-midnight) 캔버스 위에 브랜드 퍼플(#5F0080)을 구조적 액센트로,
데이터는 모노스페이스로 정밀하게, 위계는 세리프 디스플레이 + 산세리프 본문의 타이포로 완성.

> 상세: `designs/session-management/DESIGN.md` — 세션 관리 고도화 디자인 시스템

## 디자인 원칙

| 원칙 | 적용 |
|---|---|
| **타이포 우선** | 위계는 폰트 크기·굵기·자족(font-family)으로 먼저 잡는다 |
| **퍼플은 구조로** | `#5F0080`는 액티브 상태·포커스 링·라이브 표시 등 의미에만 사용 |
| **금지 패턴** | glassmorphism, 무지개 그라디언트, 가짜 차트, 스톡 히어로 |
| **데이터 정직성** | EEG 대시보드는 실제 기능. 예시 값은 `샘플 데이터` 배지로 명시 |
| **다크 + 절제** | 한 화면에 액센트 컬러 1~2개. 나머지는 무채색 + 퍼플 톤 그레이 |

## 컬러 토큰

### 캔버스 (다크, 퍼플 언더톤)

```
--bg-0:   #0E0A12     최하단 배경
--bg-1:   #161019     패널 / 사이드바
--bg-2:   #1E1726     카드 (raised)
--bg-3:   #2A2033     카드 hover / inset
--bg-elev:#241B2E     모달 / 팝오버
```

### 브랜드 퍼플

```
--purple-700: #5F0080   ★ 브랜드 Primary
--purple-500: #9333B8   버튼/필
--purple-400: #B05CD0   액센트 텍스트·라인
--purple-300: #D29BE8   링크 / 하이라이트
```

### 텍스트

```
--text-hi:  #F4F0F7     제목 / 강조
--text-mid: #B7AEC2     본문 / 보조
--text-lo:  #7C7388     캡션 / 비활성
```

## 타이포그래피

| 용도 | 폰트 | 비고 |
|---|---|---|
| 디스플레이 / 제목 | Playfair Display (serif) | 위계 표현 |
| 본문 / UI | Inter (sans-serif) | 가독성 |
| 데이터 / 코드 | JetBrains Mono (mono) | EEG 수치, 타임스탬프 |

## 디자인 토큰 시스템

**W3C Design Tokens 기반 SSOT.** `design-system/tokens/`에서 JSON 정의 → Style Dictionary 빌드 → CSS 변수 + Tailwind preset + TypeScript 상수.

```
design-system/
├── brand/identity.md          ← 브랜드 SSOT
├── tokens/
│   ├── brand/  (color, typography, motion)
│   ├── system/ (light, dark, spacing, radius, shadow)
│   └── ui/     (button, input, card, ...)
└── build/outputs/
    ├── css/tokens.css
    ├── tailwind/preset.cjs
    └── ts/tokens.ts
```

> 빌드 명령: `cd design-system && npm run build`
> 상세: `design-system/README.md`

## 컴포넌트 라이브러리

- **프레임워크**: React 18 + TypeScript, Tailwind CSS 3 + shadcn/ui
- **차트**: Recharts (EEG 대시보드)
- **실시간**: Socket.IO (세션 상태, EEG 스트림)
- **화상**: LiveKit (WebRTC)

## 디자인 레벨

| 프로젝트 | 레벨 | 도구 |
|---|---|---|
| MIND BREEZE 2.0 | 🥇 Full | DESIGN.md + Pencil 프로토타입 |

## 관련 문서

- `design-system/brand/identity.md` — 브랜드 아이덴티티 전문
- `design-system/README.md` — 토큰 시스템 구조·빌드·변경 절차
- `designs/session-management/DESIGN.md` — 세션 관리 고도화 디자인 상세
- `docs/MIND_BREEZE_2.0_종합_기획.md` §12 — 디자인 시스템 요구사항
