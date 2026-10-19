# SDD-218 — 클래스 리포트 관리와 회원 변화 추이

새 워크스페이스의 시작 문서입니다. 2026-10-20 생성. **현재는 착수 준비와 Spec 초안 단계이며 구현 승인을 받은 상태가 아닙니다.**

- Paseo: **SDD-218 클래스 리포트 관리와 회원 변화 추이**
- workspace ID: `wks_0c6f56c31a55f90e`
- 브랜치: `sdd/218-class-structure-phase5`
- 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd218`
- 생성 기준: 공식 `scripts/sdd new ... --worktree`가 fetch한 `origin/develop`, SHA `a4acf6ba0c434fd40f7eb70ce573e7ad1a7699b4`.
- 원격에는 번호 예약 참조만 생성됐습니다. 제품 커밋·작업 브랜치 push·PR·배포는 하지 않았습니다.

## 먼저 읽기

1. [SDD 범위 초안](specs/sdd-218-class-structure-phase5/spec.md)
2. [착수 보고서·선행 의존성·다음 작업](specs/sdd-218-class-structure-phase5/kickoff.md)
3. [클래스 우선 출시 기획 스냅샷](specs/sdd-218-class-structure-phase5/reference/class-first-roadmap.md)
4. [결정 목록 스냅샷](specs/sdd-218-class-structure-phase5/reference/decisions.md)
5. [기존 리포트 상세 기획](docs/class-session-restructure/기획-상세-리포트.md) — 오래된 현행 설명은 코드와 재대조합니다.

## 다음 담당자 실행 순서

- 이 문서와 spec/kickoff를 읽고 217 통합 상태를 확인합니다.
- D-36 승인 주체, D-37 자동 승인 분리 범위, D-43 비회원 추이 범위를 사용자와 확정합니다. 초안의 제안을 승인 사실로 간주하지 않습니다.
- Spec 및 화면 방향을 확정한 뒤 plan.md와 **구현 전** verify.md를 작성하고 승인을 받습니다.
- 217이 develop에 통합된 후 최신 develop을 반영하고, 실제 공통 모델/API 및 단일 Alembic head를 확인합니다.
- 그 뒤 의존성 설치·기준선·구현을 진행합니다. 이번 준비 작업에서는 실행환경 의존성을 설치하거나 제품 테스트를 실행하지 않았습니다.

**SDD-217 제품 코드는 이 워크스페이스에 포함되지 않았습니다.** 217 미커밋 변경을 복사·커밋·병합하거나 기존 워크트리를 정리하지 마세요. 현재 218은 문서 정리용으로 준비됐으며 제품 구현은 선행 통합과 승인 이후입니다.

참고 스냅샷의 과거 `specs/.sdd-counter` 번호 발급 안내는 적용하지 않습니다. 현행 AGENTS.md·브랜치 규칙과 공식 `scripts/sdd`만 따릅니다.
