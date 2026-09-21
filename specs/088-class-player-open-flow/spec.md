# SDD-088 — 클래스 입장·시작·종료 프로세스 + 독립형 공통 플레이어

> 상세 기획: `docs/class-entry-start-end-player-기획.md` (반드시 먼저 읽고 구현)
> 클래스 수명주기 재정의(open 상태 추가) + 버튼 단순화 + 상담사·회원 공통 풀스크린 플레이어.
> **claude(fable) 위주 개발**.

## 1. 확정 결정 (Brian)
1. **`opened_at` 컬럼 추가** (nullable) — 대기 경과 표시·지표용. 마이그레이션 add_column 1건.
2. **대기 중 EEG는 리포트에서 제외** — 리포트 집계에 `started_at ~ ended_at` 구간 필터 추가 (대기 중 데이터는 표시용만).
3. **1:1 즉석 세션도 오픈 단계 거침** — 동일 플로우. 단 [오픈]→[시작] 연타 허용(강제 대기 없음).
4. **오픈된 방 "닫기" 기능** — 목록에 "오픈" 뱃지 노출 + 상담사가 오픈된 방 닫기(cancel) 가능.

## 2. 핵심 설계 (기획서 요약)

### 상태 머신 확장
```
ready/scheduled → open(오픈/대기) → in_progress(진행중) → completed(종료)
```
- 신규 액션 `open`: ready/scheduled → open (상담사 "클래스 오픈")
- `start` 출발 상태에 `open` 추가 (+과도기 ready/scheduled 유지)
- `cancel`에 `open` 추가 (오픈된 방 닫기)
- `ACTIVE_STATUSES`에 `open` 추가
- `end`는 in_progress/paused에서만 (open에서는 불가)

### 버튼 단순화
- "시작" 버튼 제거 → **[입장] 단일 버튼** (목적지 `/sessions/:id/player`)
- 상태 전이 버튼(오픈/시작/종료)은 플레이어 안에만 존재

### 독립형 공통 플레이어
- `ClassPlayerPage` 신설 (풀스크린, AppShell 밖)
- 상담사/회원 동일 플레이어, 역할·상태에 따라 씬만 달라짐
- 씬: ① 세팅(ready) → ② 대기실(open) → ③ 라이브(in_progress) → ④ 종료(completed)

### 이탈 보수 처리
- `useLeaveGuard` 훅: beforeunload + useBlocker
- open/in_progress/paused에서 상담사 이탈 시 경고·확인 (진행중은 최고 강도)
- 종료 2단계 확인 모달

## 3. 구현 범위

### Phase A — BE 상태 머신 + 버튼 단순화 + 이탈 가드
- A1: `session_service.py` TRANSITIONS에 `open` 액션 + start/cancel 갱신 + ACTIVE_STATUSES에 open
- A2: `opened_at` 컬럼 추가 (마이그레이션) + open 전이 시 기록
- A3: `join_session_by_code`: ready/scheduled 입장 거부("아직 오픈 전") + open부터 허용
- A4: 리포트 EEG 집계에 started_at~ended_at 구간 필터 (대기 중 데이터 제외)
- A5: BE pytest (전이 매트릭스, 조인 게이트, 구간 필터)

### Phase B — FE 플레이어
- B1: `SessionStatus`에 'open' + StatusBadge/라벨 매핑 3곳
- B2: SessionListTable/SessionDetailPage "시작" 제거, [입장] 단일화 + "오픈" 뱃지 + [닫기] 액션
- B3: `ClassPlayerPage` 신설 (풀스크린, 씬 라우팅)
- B4: SessionLivePage 로직을 씬 컴포넌트로 분해 이전 (/live → /player 리다이렉트)
- B5: class-join-page의 waiting/meditation/complete 렌더를 플레이어 씬으로 이전
- B6: `useLeaveGuard` 훅 + 종료 2단계 모달
- B7: ClientSessionDetailPage 입장 활성 조건 open||in_progress||paused

### Phase C — 정리 (후속, 이번 범위에서 선택)
- start 출발 상태에서 ready/scheduled 제거는 과도기 유지 (기존 테스트·하위 호환)

## 4. 완료 기준
- 상태 머신 open 지원 + 오픈된 방 닫기
- [입장] 단일 버튼 + 독립형 공통 플레이어 동작
- 이탈 보수 처리 (open/진행중 경고)
- 대기 중 EEG 리포트 제외 (구간 필터)
- BE pytest 통과, FE build 0 error
