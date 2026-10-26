# SDD-221 Summary — 홈 화면 통계와 이동 동작 보완

- 상태: Stage ⑥ Summary — Brian 최종 리뷰 대기 (사후 정리: 2026-10-20 통합 이후 작성)
- 브랜치: `sdd/221-home-dashboard-actions` → develop 병합 `8e1b12e2` (2026-10-20)
- 근거: spec/plan/verify, `team-instructor-finding.md`, 커밋 기록(`git log --grep 'sdd-221'`)
- 문서·커밋에 기록된 사실만 적는다.

---

## 1. 무엇을 만들었나

| 요구 | 결과 | 커밋 |
|---|---|---|
| 3.1 수치 정합 | 타일 수치를 목록과 같은 기준으로 계산하는 순수 함수(`home-stats`)로 분리: 진행 중=진행 중+오픈, 검토 대기=상담 제외 클래스 합, 오늘 예정=취소·완료 제외 | `5fe26941` |
| 3.2 타일 링크화 | 요약 타일 4종 전체를 링크로(진행 중·검토 대기·오늘 예정·참여자). 참여자 타일 문구는 통합 시 '회원 관리'로 | `5fe26941`, `dd334ae4` |
| 3.3 카드 전체 클릭 | 일정·클래스 카드 전체를 링크 영역으로, 내부 버튼은 기존 동작 유지 | `5fe26941` |
| 3.4 새 알림 클릭 | 알림 행 클릭 시 읽음 처리 후 `resolveNotificationTarget` 경로로 이동 | `5fe26941` |
| 3.5 회원 홈 데스크톱 | 시안 2안과 DOM 측정 기록 후 구현: 회원 홈 B안 격자, 내 클래스 가로 탐색 | `6c073a53`, `14e8aa01`, `868af673` |
| T5 팀 강사 회차 누락 | 재현 후 서버 수정(아래 §2) | `4256a242` |
| 응답 스키마 결함 | 대시보드 응답 스키마에 검토 대기 수가 없어 항상 0 으로 보이던 문제 수정 | `7001bd2b` |

### 팀 강사 회차 누락 (T5 판정: 재현됨 → 서버 수정)
`counselor_dashboard` 가 `Session.host_id == 본인` 만 집계해, 팀 강사(lead/assistant)로만 속한 클래스의 타 강사 회차가 홈 타일·목록에서 빠졌다. `dashboard_service.py` 에서 본인이 active lead/assistant 인 클래스의 비템플릿 회차를 합집합으로 포함(중복 제거). 응답 필드 불변, 마이그레이션 없음.
노출 범위: 타 강사 회차의 `report_count`·`pending_review_count` 는 0 으로 반환(리포트 검토는 진행 강사 몫, 팀 열람은 별도 동의 경로). 그 결과 홈 '검토 대기' 타일은 본인이 host 인 회차만 센다.

---

## 2. 테스트 결과 (기록된 것만)

- 팀 강사 건: 신규 `test_sdd221_dashboard_team_instructor.py` 3건 — 첫 테스트가 수정 전 코드에서 실패, 수정 후 통과. 관련 파일(`test_sdd081_personal_office.py`, `test_sdd015_class_code.py`, `test_mb2_low_fixes_4th.py`, `tests/contract`) 합계 **132 passed**. Alembic 파일 변경 없음.
- 통합 보정: `dashboard-card-navigation.test.tsx` 를 SDD-221 이동 경로에 맞게 수정(`dd334ae4`).
- 통합 로컬 검증: 백엔드 3389 passed, 프론트 실패 12건은 develop 기준선과 동일.
- 최종 Deploy Dev 스모크 7/7, 여정 32/32, 회귀 1/1, 전수조사 25/25 통과.
- verify.md 의 항목별(A~H) 통과 표는 별도로 기록되어 있지 않다. 프론트 신규 vitest 의 개별 통과 수치는 커밋 메시지에 남아 있지 않아 적지 않는다.

---

## 통합 기록 (2026-10-20, SDD-220~224 일괄 통합)

SDD-220~224 를 같은 날 develop 에 일괄 통합했다. 병합 커밋: 223 `6c86ec92` · 222 `8a24a400` · 224 `5c5c190f` · 220 `b6f57a45` · 221 `8e1b12e2`, 통합 보정 `dd334ae4`.

- 충돌 해결: `useEegRawUpload.ts` import, `package.json`(Capacitor 8.5.3 + keep-awake 동시 반영), android `strings.xml`, `DashboardPage.tsx`(SDD-221 쪽 채택).
- 로컬 검증: 백엔드 **3389 passed**, 프론트 실패 **12건은 develop 기준선과 동일**(통합으로 늘지 않음).
- 이후 수정: `d401fbd1` dev 배포 빌드를 `mode=dev` 로 변경(SDD-220 의 운영 빌드 분기가 dev 번들에 운영 API 주소를 넣어 dev 로그인이 실패하던 문제), `f89e5a24` 스모크를 녹음·녹화 필수 동의 체크와 AI 비공개 기본값에 맞춤.
- 최종 Deploy Dev 스모크: **7/7**, 여정 **32/32**, 회귀 **1/1**, 전수조사 **25/25** 통과.
- dev 는 AI 비공개 상태로 테스트하기로 결정(Brian).
- `DashboardPage.tsx` 충돌은 SDD-221 쪽을 채택했다. SDD-220 plan 상 해당 파일 변경은 AI 진입 차단·문구였다.

---

## 3. 남은 일 · 이월

- **H3 dev 실데이터(팀 강사 계정) 확인**: 문서에 확인 기록이 없다(verify H 구간 미기재).
- **상담 세션이 홈 통계 합계에 섞이는지(SDD-219 C1)**: 221 은 홈 화면 한정으로 흡수했으나 서버 전역 집계 정리는 후속이며, 현재 **SDD-225** 로 처리 중(`558d47f4` spec·plan·verify 작성).
- 센터 관리자용 클래스 단위 대시보드 신설, `total_classes` 의미 교정은 범위 밖(219 에서 후속 분류).
- `OrgDashboardPage` 동일 증상 점검(T4)은 plan 에 있으나 별도 결과 기록이 없다.
