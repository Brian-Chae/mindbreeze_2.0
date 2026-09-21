# SDD-088 — 구현 요약 (Stage ⑥)

> 클래스 입장·시작·종료 프로세스 재설계 + 독립형 공통 플레이어.
> 구현: claude(fable) worker · 2026-09-21

## 결과

- BE `venv/bin/pytest`: **722 passed, 12 skipped** (기존 705 유지 + SDD-088 신규 17)
- FE `npm run build` (tsc -b + vite): **0 error**

## Phase A — BE 상태 머신

| 항목 | 구현 |
|---|---|
| A1 전이 매트릭스 | `session_service.py` TRANSITIONS에 `open: ({ready,scheduled} → open)` 추가. `start` 출발에 `open` 추가(과도기 ready/scheduled 직행 유지 — 기존 테스트·1:1 하위 호환). `cancel` 출발에 `open` 추가(오픈된 방 닫기). `end`는 in_progress/paused만(변경 없음) |
| A2 opened_at | `Session.opened_at`(nullable) + 마이그레이션 `e036a0000013` add_column 1건. open 전이 시 최초 1회 기록. `_serialize`/`SessionResponse`에 노출. ACTIVE_STATUSES에 `open` 포함(중복 개설 방지) |
| A3 조인 게이트 | `join_session_by_code`: ready/scheduled → 400 "아직 오픈 전인 클래스입니다…" (host 본인의 no-op 참여는 허용). open/in_progress/paused부터 입장 허용 |
| A4 EEG 구간 필터 | `report_task._build_eeg_content`에 `started_at~ended_at` 경계 인자 추가(created_at 기준). 리포트 생성 경로에서 세션 경계 전달 — 대기실 수집 EEG는 집계 제외. 경계 없으면(레거시/직접 호출) 전체 유지 |
| A5 pytest | `tests/test_sdd088_open_flow.py` 17건: 전이 매트릭스(오픈/시작/닫기/종료불가/중복/403), 1:1 연타, 조인 게이트, 구간 필터 |
| 부수 반영 | `api/v1/session.py` 액션 루프에 `open` 등록. `org_public_service` 공개 노출 + `org_management_service` 집계·정리 게이트에 `open` 포함. 오디오/비디오 녹음 가드에는 `open` 미포함 → 대기 중 녹음·녹화 서버측 자동 차단(기획 §3.3) |
| 테스트 정합 | by-code 조인을 쓰는 10개 테스트 파일에 "생성 후 오픈" 단계 반영(헬퍼 중심), sdd021 test_12는 open 상태 검증으로 갱신 |

## Phase B — FE 플레이어

| 항목 | 구현 |
|---|---|
| B1 상태 타입 | `SessionStatus`에 `'open'`, `SessionAction`에 `'open'`, `SessionDto.opened_at`. 라벨 3곳: `StatusBadge`(오픈), `class-join-page`(입장 가능), `ClientSessionDetailPage`(입장 가능) |
| B2 버튼 단일화 | `SessionListTable`: "시작" 제거, [입장] 단일(→ `/sessions/:id/player`) + open 행 [닫기](confirm 후 cancel). `SessionDetailPage`: 전이 버튼 제거([닫기/취소]만), [입장] 추가 |
| B3 플레이어 | `pages/sessions/ClassPlayerPage.tsx` 신설 — 풀스크린(AppShell 밖), 씬 라우팅: ①세팅(프리뷰+[클래스 오픈]) → ②대기실(코드 대형+참가자 그리드+[시작하기], opened_at 대기 타이머) → ③라이브(셀프뷰·모니터링·녹음·마커, SDD-083~085 로직 이전) → ④종료([기록 보기]) / 닫힘 씬. Wake Lock 대기·진행 중 유지 |
| B4 /live 정리 | `SessionLivePage` → `/player` 리다이렉트만 잔존. 라우트 추가: `/sessions/:id/player` |
| B5 회원 씬 이전 | `components/player/MemberWaitingScene`·`MemberSessionScene`으로 waiting/meditation 렌더 이전. `class-join-page`는 code/details 게이트 유지 + 오픈 전 참여 차단(안내+3초 폴링 자동 활성화) |
| B6 이탈 가드 | `hooks/useLeaveGuard`(beforeunload + useBlocker, 콜백 판정으로 bypass 지원). App 라우터를 `createBrowserRouter` 데이터 라우터로 전환(useBlocker 요건). `LeaveGuardModal`: open=[닫고 나가기/오픈 유지 나가기/계속], in_progress=[종료 후 나가기/계속](단순 나가기 없음). `EndSessionModal` 2단계 종료 확인(window.confirm 대체) |
| B7 회원 입장 조건 | `ClientSessionDetailPage` 입장 활성 `open || in_progress || paused` |

## 결정 반영 (Brian 4건)

1. `opened_at` 컬럼 — 추가(마이그레이션 1건, 대기 경과 타이머에 사용)
2. 대기 중 EEG 리포트 제외 — started_at~ended_at 구간 필터
3. 1:1 즉석 세션 — 동일 오픈 플로우, [시작하기]는 그룹만 참가자≥1 가드(1:1 연타 허용, 테스트 9)
4. 오픈된 방 닫기 — "오픈" 뱃지 + 목록/상세/플레이어 3곳에서 cancel 가능

## 주의·후속(Phase C 후보)

- `start`의 ready/scheduled 직행은 과도기 유지 — 플레이어 전면 정착 후 제거
- 상태 라벨 매핑은 여전히 3곳(기존 구조 유지) — 후속 단일 모듈화 후보
- 플레이어 이탈 후 재입장 시 녹음·녹화 자동 재개는 미구현(재입장 시 상태 기준 씬 복원만) — 청크 업로드 구조라 기존 데이터는 보존됨
