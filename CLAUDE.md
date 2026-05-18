# MIND BREEZE 2.0 — Claude Code Guide

> 뇌파(EEG) 기반 심리상담 · 명상 통합 서비스 플랫폼.
> LINK BAND 2.0으로 실시간 뇌파 측정(선택) + AI 기반 자동 기록·요약·리포트.
> 상세 기획: `docs/MIND_BREEZE_Service_Plan.md` / `docs/PRD_MVP1_MVP2.md` / `docs/PRD_User_Mobile_Service.md`

## 언어

- 모든 응답은 **한글**로 작성한다.
- 코드 주석, 커밋 메시지도 한글을 기본으로 한다.
- 변수명/함수명/파일명 등 코드 식별자는 영문 유지.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | React 18 + TypeScript, TanStack Query, Zustand, Recharts/D3 |
| BLE 연동 | Web Bluetooth API (Chromium 기반 브라우저) |
| Realtime | WebSocket (Socket.IO) |
| Backend | FastAPI (Python), Celery + Redis |
| Database | PostgreSQL + TimescaleDB (시계열 EEG) |
| ORM | SQLAlchemy + Alembic |
| AI/ML | STT(Whisper/Clova), Diarization(pyannote), LLM(Claude/GPT), EEG 분석(Looxid SDK) |
| Storage | S3 호환 (음성 녹음, 리포트 PDF) |
| 스타일링 | Tailwind CSS 3 + shadcn/ui |
| 테스트 | vitest (unit) + Playwright (E2E) |
| 패키지 매니저 | npm |

## 프로젝트 구조

```text
mindbreeze_2.0/
├── frontend/                   # React SPA (관리자 + 내담자 웹)
│   ├── src/
│   │   ├── components/         # UI 컴포넌트
│   │   ├── pages/              # 라우트 페이지
│   │   ├── hooks/              # 커스텀 훅 (BLE, WebSocket)
│   │   ├── stores/             # Zustand 상태 스토어
│   │   └── lib/                # 유틸리티, API 클라이언트
│   └── public/
├── backend/                    # FastAPI 서버
│   ├── app/
│   │   ├── api/                # REST 엔드포인트
│   │   ├── core/               # 설정, 보안, 의존성
│   │   ├── models/             # SQLAlchemy 모델
│   │   ├── schemas/            # Pydantic 스키마
│   │   ├── services/           # 비즈니스 로직
│   │   └── tasks/              # Celery 태스크 (STT, AI 요약)
│   ├── alembic/                # DB 마이그레이션
│   └── tests/
├── design/                     # Pencil 디자인 프로토타입
│   └── front-master.pen        # 전체 IA·화면 설계
├── specs/                      # Sprint 단위 SDD 스펙
│   └── <unix-ts>-feature/
│       ├── spec.md
│       ├── plan.md
│       └── tasks.md
├── docs/                       # 기획 문서
│   ├── MIND_BREEZE_Service_Plan.md
│   ├── PRD_MVP1_MVP2.md
│   ├── PRD_User_Mobile_Service.md
│   └── VARIANT_AI_LOGIN_DESIGN_BRIEF.md
├── .claude/                    # Claude 하네스
│   ├── agents/                 # 도메인 에이전트
│   ├── rules/                  # 코딩 규칙
│   └── hooks/                  # 자동화 훅
└── .specify/                   # spec-kit 템플릿·스크립트
```

## 주요 명령어

```bash
# Frontend
cd frontend && npm run dev       # Vite dev 서버
cd frontend && npm run build     # 프로덕션 빌드
cd frontend && npm test          # vitest

# Backend
cd backend && uvicorn app.main:app --reload  # 개발 서버
cd backend && pytest                        # 테스트
cd backend && alembic upgrade head          # DB 마이그레이션
```

## 서비스 도메인

| 개념 | 설명 |
|---|---|
| 세션 (Session) | 상담/명상 수업 단위. 유형: 임상심리상담·최면심리상담·명상수업. 상태: 예정/진행중/완료/취소 |
| 참여자 (Participant) | 내담자(1:1) 또는 수업 참여자(그룹). LINK BAND 착용은 선택(opt-in) |
| EEG 레코드 | LINK BAND 착용 시에만 생성. Raw 데이터 + 분석 결과(집중도/이완도/스트레스) |
| 세션 기록 (SessionRecord) | 음성 녹음 → STT 변환 → 화자 분리 → AI 요약 → 기록지 |
| 리포트 (Report) | 상담사용 + 내담자용. 세션 요약 + (선택) 뇌파 분석 + 추이 그래프 |
| 셀프 트레이닝 (Training) | MVP3 범위. 상담사 처방 → 내담자 수행 → 데이터 연계 |

## LINK BAND 연동

- **BLE 프로토콜**: Web Bluetooth API (Chrome/Edge 등 Chromium 기반)
- **서비스 UUID**: LINK BAND 2.0 GATT 서비스 (2채널 EEG, BLE 5.0)
- **데이터**: EEG 250Hz Raw → AI 분석 파이프라인 → 집중도/이완도/스트레스 지수
- **제약**: Safari/Firefox 미지원 → 브라우저 안내 UX 필수
- **선택적 사용**: LINK BAND 미착용 시에도 상담·AI 요약·리포트 핵심 기능 제공

## 코딩 컨벤션

| 영역 | 규칙 |
|---|---|
| 파일명 | kebab-case |
| 컴포넌트 | PascalCase |
| 함수/변수 | camelCase |
| Python | snake_case (PEP 8) |
| 불변성 | 객체 직접 변경 금지, 복사 후 수정 |
| 타입 | `any` 사용 금지, 명시적 인터페이스 사용 |

## Spec-Driven Development

**핵심 원칙**: QA List = Spec. QA 항목이 곧 테스트 케이스이자 수락 기준.

### 파이프라인

| Stage | 설명 | Output |
|---|---|---|
| 1 | spec.md 작성 (QA List 포함) | `specs/<unix-ts>/spec.md` |
| 2 | plan.md 작성 | `specs/<unix-ts>/plan.md` |
| 3 | tasks.md 작성 | `specs/<unix-ts>/tasks.md` |
| 4 | 구현 | 소스 코드 |
| 5 | 코드 리뷰 | 리뷰 결과 |
| 6 | 테스트 + 빌드 검증 | `npm test && npm run build` |

### 스펙 위치

`specs/<unix-ts>-feature-name/` — Unix epoch timestamp 기준 디렉토리. 숫자가 클수록 최근 생성.

## 프로젝트 에이전트

`.claude/agents/`에 5개 에이전트 정의:

| 에이전트 | 역할 | 사용 시점 |
|---|---|---|
| **qa-test-writer** | 스펙 QA → 테스트 코드 생성 (RED) | Stage 2 |
| **planner** | 구현 계획 + 아키텍처 설계 | 복잡한 기능, 리팩토링 |
| **code-reviewer** | 코드 품질 + 보안 검토 | 코드 작성 직후 |
| **build-validator** | 빌드/타입 검증 | 변경 후 검증 |
| **tdd-guide** | TDD 워크플로우 (vitest/pytest) | 새 기능, 버그 수정 |

## 알려진 이슈 / 설계 결정

1. **LINK BAND 선택적 사용**: 모든 기능은 LINK BAND 없이도 동작해야 함. EEG 관련 기능은 `if (bandConnected)` 가드 필수.
2. **Web Bluetooth 제약**: Chrome/Edge 권장. 미지원 브라우저 감지 → 안내 메시지 표시.
3. **실시간 데이터**: WebSocket 기반. 1:1 상담은 단일 뷰, 명상 수업은 다자 그리드 뷰(MVP3).
4. **AI 파이프라인**: STT → Diarization → LLM 요약은 Celery 비동기 큐로 처리. 수 분 소요.
5. **데이터 프라이버시**: 뇌파 데이터 + 상담 내용 → 접근 제어, 동의 플로우, 보관 기간 정책 필수.
6. **MVP1+2 통합 릴리스**: 14주. 인증, 세션·내담자, BLE+1:1 대시보드, 녹음·STT·AI 기록지·리포트.
