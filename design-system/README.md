# MIND BREEZE Design System

> **SSOT-driven design system.** Tokens are defined once in `tokens/*.json` (W3C 표준) and built into CSS variables, Tailwind preset, and TypeScript constants.

## 구조

```
design-system/
├── brand/                      ← Brand SSOT (마스터 문서)
│   ├── identity.md             ← 미학·voice·시그니처 정의 (v1.0.0)
│   └── (voice-tone.md, logo-usage.md - 향후)
├── tokens/                     ← 토큰 SSOT (W3C Design Tokens 포맷)
│   ├── brand/                  ← 원시 토큰 (raw primitives)
│   │   ├── color.json          ← 컬러 팔레트
│   │   ├── typography.json     ← 폰트 패밀리·웨이트
│   │   └── motion.json         ← duration·easing 원시값
│   ├── system/                 ← 시맨틱 별칭 (purpose-bound)
│   │   ├── light.json          ← 라이트 테마
│   │   ├── dark.json           ← 다크 테마
│   │   ├── spacing.json        ← 4/8 그리드
│   │   ├── radius.json         ← 모서리 스케일
│   │   ├── shadow.json         ← 그림자
│   │   └── typography.json     ← 타입 스케일
│   └── ui/                     ← 컴포넌트별 토큰
│       ├── button.json
│       ├── input.json
│       ├── card.json
│       └── ...
└── build/                      ← 빌드 파이프라인
    ├── style-dictionary.config.mjs
    └── outputs/
        ├── css/tokens.css      ← CSS 변수 (frontend가 import)
        ├── tailwind/preset.cjs ← Tailwind preset
        └── ts/tokens.ts        ← 타입 안전 상수
```

## 토큰 3계층 (W3C Design Tokens)

| 계층 | 예시 | 변경 빈도 | 사용처 |
|------|------|---------|--------|
| **Brand (원시)** | `color.sage.500: #88A887` | 매우 낮음 | 시스템·UI 토큰에서만 참조 |
| **System (시맨틱)** | `surface.canvas: {color.oat.50}` | 가끔 | UI 토큰·컴포넌트에서 참조 |
| **UI (컴포넌트)** | `button.primary.bg: {surface.brand.primary}` | 컴포넌트 추가 시 | React 컴포넌트에서만 직접 참조 |

**규칙**: 위 계층의 토큰은 같거나 더 낮은 계층만 참조한다. UI 토큰이 brand 원시값을 직접 참조하면 안 된다 (시맨틱 계층 우회 금지).

## 빌드

```bash
cd design-system
npm install              # style-dictionary
npm run build            # JSON → CSS + Tailwind + TS 일괄 생성
npm run watch            # 개발 중 자동 재빌드
```

빌드 출력은 `frontend/src/styles/tokens.css`, `frontend/tailwind.preset.cjs`, `frontend/src/types/tokens.ts`로 복사된다.

## 변경 절차

1. **brand/identity.md** 갱신 (전략 수준 변경 시)
2. **tokens/*.json** 갱신 (원시값·시맨틱 별칭·컴포넌트 토큰)
3. `npm run build` 실행
4. 빌드 출력 커밋
5. PR에서 변경 영향 명시

## 현재 상태

- ✅ Brand SSOT 정의 (Clinical Garden, Light-first) — `brand/identity.md`
- ✅ 토큰 SSOT 10개 파일 (brand 3 + system 6 + ui 1) — W3C $value/$type
- ✅ Style Dictionary 빌드 파이프라인 동작 — `build/outputs/`
- ⏳ 추가 컴포넌트 토큰 (input, card, modal, badge...)
- ⏳ frontend/ 부트스트랩 (Vite + Tailwind + 토큰 연결)
- ⏳ 로그인 화면 Clinical Garden 시안

## 참고

- Brand Identity: [`brand/identity.md`](./brand/identity.md)
- 종합 기획서 §12: `docs/MIND_BREEZE_2.0_종합_기획.md`
- W3C Design Tokens Spec: https://www.w3.org/community/design-tokens/
