# MIND BREEZE 2.0 — Codex Guide

> 뇌파(EEG) 기반 심리상담 · 명상 통합 서비스 플랫폼.
> LINK BAND 2.0으로 실시간 뇌파 측정(선택) + AI 기반 자동 기록·요약·리포트.
> 상세 기획: `docs/MIND_BREEZE_2.0_종합_기획.md` / `docs/MIND_BREEZE_2.0_기능명세서.md` / `docs/MIND_BREEZE_2.0_개발_기획서.md` / `docs/AI_STACK_DECISION.md`

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
| Database | PostgreSQL (OLTP). EEG Raw → S3 Parquet |
| ORM | SQLAlchemy + Alembic |
| AI/ML | STT(Gemini Audio→Whisper+pyannote), 요약(Codex→Gemini), OCR(Gemini Vision), EEG(Looxid SDK) — `docs/AI_STACK_DECISION.md` |
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
│   ├── MIND_BREEZE_2.0_종합_기획.md
│   ├── MIND_BREEZE_2.0_기능명세서.md
│   ├── AI_STACK_DECISION.md
│   └── Archives/               # 구 PRD·기획서
├── .Codex/                    # Codex 하네스
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

## 7-Stage SDD (Spec-Driven Development) (2026-06-05~)

> 모든 프로젝트에 적용되는 7-Stage 방법론. `sdd-workflow` 스킬 기반.
> **Stage ③ Verify는 구현 전 필수 게이트** — 건너뛰면 안 됨.

| # | Stage | 산출물 | 설명 | Brian 개입 |
|---|-------|--------|------|-----------|
| ① | **Spec** | `specs/NNN/spec.md` | 무엇을 왜 만드는지 | ✅ go/no-go |
| ② | **Plan** | `specs/NNN/plan.md` | 어떻게 만들지 (아키텍처, Task) | ❌ 자동 |
| ③ | **Verify** | `specs/NNN/verify.md` | 구현 전 QA 체크리스트 (🚨 필수 게이트) | ✅ 승인 후 구현 |
| ④ | **Implement** | 코드 | plan.md Task 순차 구현 | ❌ 자동 |
| ⑤ | **Test** | 테스트 실행 | verify.md 시나리오 실제 테스트 | ❌ 자동 |
| ⑥ | **Summary** | `specs/NNN/summary.md` | 구현 결과, 디버깅, 테스트 정리 | ❌ 자동 |
| ⑦ | **Review** | 승인 | Brian 최종 리뷰 → Done | ✅ 승인 |

### 핵심 규칙

- **spec + plan + verify + summary 4종 모두 존재해야 SDD 완료**
- **Stage ③ Verify는 구현 전에만 작성. 사후 작성 금지.**
- Git commit: `feat(sdd-NNN):` / `fix(sdd-NNN):` 태그 포함
- 스펙 번호는 `scripts/sdd new "한글 제목" <슬러그>` 로 발급 (`.sdd-counter` 폐기 — 규칙: `.claude/rules/branch-management.md`)

### 스펙 디렉토리 구조

```
specs/
├── 001-feature/          # SDD-001
│   ├── spec.md           # Stage ①
│   ├── plan.md           # Stage ②
│   ├── verify.md         # Stage ③ (구현 전)
│   └── summary.md        # Stage ⑥
└── ...
```

### 카드 태그별 간소화

| 태그 | Spec | Plan | Verify | Implement | Test | Summary | Review |
|------|------|------|--------|-----------|------|---------|--------|
| [SDD] | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Fix] | 생략 | 원인분석 | ✅ | Fix | ✅ | ✅ | ✅ |
| [Refactor] | 생략 | ✅ | ✅ | Refactor | ✅ | ✅ | ✅ |
| [Chore] | 생략 | 생략 | 생략 | Execute | 간소화 | ✅ | ✅ |

> 상세: `sdd-workflow` 스킬 참조.

## Superpowers 적용 (2026-05-30~)

> 이 프로젝트는 [obra/superpowers](https://github.com/obra/superpowers) (v5.1.0, ⭐212k) 플러그인을 사용합니다.
> Codex 호출 시 **brainstorming → writing-plans → test-driven-development → subagent-driven-development** 파이프라인이 자동 발동됩니다.

### Superpowers 자동화 파이프라인

| 단계 | Skill | 설명 |
|------|------|------|
| 1 | **brainstorming** | 설계 자동 제안 + 승인 요청 (spec.md 불필요) |
| 2 | **writing-plans** | 2~5분 bite-sized 태스크로 분할 |
| 3 | **test-driven-development** | RED-GREEN-REFACTOR 강제 적용 |
| 4 | **subagent-driven-development** | 태스크별 subagent dispatch + 2단계 리뷰 |
| 5 | **requesting-code-review** | 태스크 간 자동 리뷰 (Critical 이슈는 진행 차단) |
| 6 | **finishing-a-development-branch** | 테스트 통과 → merge/PR 결정 |

### Hermes Worker 디스패치 (Superpowers 적용)

```bash
# 기존: Codex -p 'specs/NNN/spec.md 읽고 구현하세요...' --allowedTools "Read,Write,Edit,Bash" --max-turns 20
# 신규: Codex -p '[미션만 전달]' --permission-mode bypassPermissions --max-turns 35 --worktree feature-name
```

- `--worktree` 필수: Superpowers의 using-git-worktrees와 연동하여 격리 환경 제공
- spec.md 전달 불필요: brainstorming이 자동 설계 제안
- `--allowedTools` 생략: Superpowers가 적절한 도구만 선택
- max-turns 35 이상: brainstorming → plan → TDD → verify 다단계 프로세스 대응

## 3-Tier Pipeline (2026-06-01~)

> 모든 신규 기능은 Phase 1→2→3 Pipeline을 통과한다. 각 Phase는 Brian의 명시적 승인 후에만 다음 Phase로 진행된다.

| Phase | Agent | Worker | 산출물 | 승인 Gate |
|-------|-------|--------|--------|-----------|
| **Phase 1** — 서비스 기획 | `product-strategist` | OpenAI (Codex) | `docs/{기능}_기획.md` | 문제 정의·MVP 범위·우선순위 |
| **Phase 2** — 디자인 기획 | `design-planner` | Gemini CLI | `designs/{기능}/` (목업·토큰·전략) | 디자인 방향·시각적 퀄리티 |
| **Phase 3** — 구현 | `planner` + `tdd-guide` | Codex (Superpowers) | `specs/` → 코드 → 배포 | 실제 동작 확인 + Design QA |

```text
Brian 요청 → Phase 1 (docs/) ──[승인]──→ Phase 2 (designs/) ──[승인]──→ Phase 3 (specs/→code)
                  ↑                               ↑                            ↑
            OpenAI/Codex                      Gemini CLI                  Codex
            시장·전략·MVP                      목업·토큰·다이어그램          SDD·TDD·구현
```

> 상세 Pipeline 명세: `multi-agent-harness` 스킬의 "3-Tier Pipeline Mode" 섹션 참조.

## 프로젝트 에이전트

`.Codex/agents/`에 7개 에이전트 정의:

| 에이전트 | Tier | 역할 | Worker |
|---|---|---|---|
| **product-strategist** | Phase 1 | 서비스 기획·MVP 정의·시장 분석 | OpenAI (Codex) |
| **design-planner** | Phase 2 | 디자인 리서치·목업·토큰·다이어그램 | Gemini CLI |
| **planner** | Phase 3 | 구현 계획 + 아키텍처 설계 | Codex |
| **qa-test-writer** | Phase 3 | 스펙 QA → 테스트 코드 생성 (RED) | Codex |
| **code-reviewer** | Phase 3 | 코드 품질 + 보안 검토 | Codex |
| **build-validator** | Phase 3 | 빌드/타입 검증 + Design QA | Codex |
| **tdd-guide** | Phase 3 | TDD 워크플로우 (vitest/pytest) | Codex |

## 알려진 이슈 / 설계 결정

1. **LINK BAND 선택적 사용**: 모든 기능은 LINK BAND 없이도 동작해야 함. EEG 관련 기능은 `if (bandConnected)` 가드 필수.
2. **Web Bluetooth 제약**: Chrome/Edge 권장. 미지원 브라우저 감지 → 안내 메시지 표시.
3. **실시간 데이터**: WebSocket 기반. 1:1 상담은 단일 뷰, 명상 수업은 다자 그리드 뷰(MVP3).
4. **AI 파이프라인**: STT → Diarization → LLM 요약은 Celery 비동기 큐로 처리. 수 분 소요.
5. **데이터 프라이버시**: 뇌파 데이터 + 상담 내용 → 접근 제어, 동의 플로우, 보관 기간 정책 필수.
6. **제품 로드맵 (31주)**: MVP1 17주(웹·B2B·AI·PC BLE) → MVP2 8주(앱·푸시·앱 BLE) → MVP3 6주(케어·고도화). 개발 착수 전 문서 정합·§18 승인.

## 브랜치·SDD 번호 규칙 (필수)

- 기능·SDD 작업은 `sdd/<NNN>-<슬러그>` 브랜치 + 전용 워크트리에서 하고 PR로 develop에 합친다. 빠른 수정만 develop 직접 푸시 가능.
- SDD 번호는 `scripts/sdd new "한글 제목" <영문-슬러그> --worktree` 로만 발급한다(`specs/.sdd-counter` 폐기). 제목은 한글(spec 첫 줄 `# SDD-NNN — 제목`, PR `[SDD-NNN] 제목`).
- 전체 규칙: `.claude/rules/branch-management.md`
- 워크스페이스 운영(TASK BOX·상시 창구·카드): `.claude/rules/taskbox.md` — 메인 체크아웃에서 코드 수정 금지, 코드 변경은 카드(워크트리)에서만.

## 작업 방식·승인 규칙 (필수, 2026-10-19)
> 어느 에이전트(Claude·Codex·Hermes)가 일하든 동일하게 적용한다. 새 세션은 이 절을 먼저 읽는다.

**소통**
- 한국어로 답한다. 보고는 개조식으로 짧게, 결론 → 근거 순. 코드 식별자는 영어 그대로 둔다.
- 기술 세부(스펙·SDD·구현)는 스스로 처리하고, 사용자에게는 **비즈니스 결정만** 묻는다. 한 번에 이슈 하나씩 순차 처리한다.
- 엉뚱한 프로젝트·경로를 헤매고 있다고 느끼면 즉시 멈추고 확인한다.

**승인이 필요한 것 (승인 전 금지)**
- 푸시 후 배포는 "배포할까요?"를 먼저 묻는다. dev 배포는 `develop` 푸시일 때만, 운영(main 머지)은 별도 승인.
- 메일·알림 임의 발송 금지(초안만, 본인 주소 테스트만 허용). 파일·데이터·브랜치 삭제는 대상을 보여 주고 승인받는다.
- 고객 개인정보·인증 토큰·DB 비밀번호는 조회·출력하지 않는다. 시크릿은 값 대신 접두사·길이만 확인하고, 키는 gitignore된 `.env`에서 읽는다.

**검증 후 보고**
- 빌드·타입 검사 통과만으로 "됐다"고 하지 않는다. 실제 동작(화면·API 응답·생성된 CSS 클래스)을 확인하고, 중요한 로직은 독립 검증 스크립트로 재확인한 뒤 보고한다. "안 바뀌었는데?"가 나오면 신뢰를 잃는다.
- 구현자와 검증자를 분리한다. 감독은 워커 결과를 diff와 테스트로 직접 재검증한다.

**설계 성향**
- 실용성·단순화 우선. 기술 완성도보다 비즈니스 결과. 서버는 AWS 관리형 + systemd 단일 프로세스를 선호한다.
- 복잡한 물리·시뮬레이션 확장은 물리 모델 정의(설계 문서, 파라미터화)를 먼저 하고 구현한다.
- 목록 화면은 테이블 + 검색·필터·그룹핑을 기본으로 한다.

**작업 기억 (세션이 끝나도 남기는 법)**
- SDD 승인 후 Stage ③~⑥은 단계별 승인 없이 연속 진행한다.
- 결정과 이유는 대화가 아니라 `specs/NNN/`의 plan·verify 문서와 PR 설명에 적는다. 다음 워커는 이것만 읽고 이어간다.
- 컨텍스트가 150K에 가까워지면 `/compact` 하거나 새 세션으로 넘기고, 인계 내용(현재 상태·남은 일·함정)을 문서로 남긴다.

**MindBreeze 전용**
- 명상·웰니스 리포트는 점수 환원 금지: 서사와 변화량만, 종합점수 금지.
- 회원 클래스 화면: 숫자·변화는 매초 실시간, 데스크톱은 5분 막대, 모바일은 현재값만.
- 이메일 주소는 불변 아이디. 기관관리자는 상담사 개인정보를 전부 수정 가능, 상담사는 다중 기관 소속 + 개인상담소 자동 개설.
- 릴리즈 전에는 dev 계정이 테스터·단독 개발 상태라 공지·점검창이 불필요하다.
- 메일 발송은 Celery email_app worker가 반드시 떠 있어야 한다.
