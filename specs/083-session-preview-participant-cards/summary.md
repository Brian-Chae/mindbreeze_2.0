# SDD-083 — 구현 요약 (Stage ⑥)

> 세션 시작 전 카메라/마이크 프리뷰 + 내담자 상태 카드 그리드 + 카드 상세(시계열).
> FE 전용 작업. BE 변경 없음.

## 구현 내용

### T1. 세션 시작 전 카메라/마이크 프리뷰
- **신규** `frontend/src/components/session/SessionPreJoinPreview.tsx`
  - `getUserMedia({video:{facingMode}, audio:true})` 로컬 프리뷰 — LiveKit 토큰 불필요, 저장·전송 없음
  - 전면/후면 카메라 전환 (`facingMode: 'user' | 'environment'`, ideal 취급이라 데스크톱에서도 안전)
  - 마이크 입력 레벨 미터 (AudioContext AnalyserNode RMS)
  - 권한 거부/미지원 시 안내 + **"그래도 시작"** 폴백
  - 시작 시 프리뷰 트랙 정리 후 `transitionSession(id,'start')` (기존 startSession 재사용)
- `SessionLivePage`: `isPreStart`(ready/scheduled)일 때 프리뷰 섹션 표시
- `SessionDetailPage`: "시작" 버튼이 즉시 전이하지 않고 라이브 페이지(프리뷰)로 이동

### T2. 내담자 상태 카드 그리드
- **신규** `frontend/src/components/session/SessionParticipantCardGrid.tsx`
  - 이름/게스트 칩 + 밴드 배지(연결됨=녹색 / 끊김=빨강 / 미사용=회색) + 접촉불량·배터리(부족 시 빨강) + 현재 지표 3종(두뇌휴식도·BPM·호흡수)
  - LINK BAND 미착용 참가자도 "밴드 미사용"으로 정상 표시
  - 기존 DashboardBox 필터(접촉불량/연결실패/배터리부족)와 연동
- **신규** `frontend/src/lib/session-live/metric-display.ts` — 테이블과 동일한 판정 규칙(연결실패·미사용·현재지표 표시 조건)을 카드에서 재사용
- 라이브 페이지에 **카드(기본) ↔ 테이블 토글** — 기존 `SessionMonitorTable`은 그대로 병행 유지

### T3. 카드 클릭 → 상세
- **신규** `frontend/src/components/session/SessionParticipantDetailPanel.tsx` (모달)
  - 현재 상태: 밴드/접촉/신호품질/배터리 배지 + 현재·평균 두뇌휴식도·BPM·호흡수
  - 세션 동안 상태 변화: Recharts LineChart 3계열(두뇌휴식도/BPM/호흡수), X축 = 세션 시작 후 경과 분
  - LINK BAND 미착용 시 안내 문구, ESC/바깥 클릭 닫기
- 시계열 데이터: `SessionLivePage`가 기존 3초 평균 갱신 리듬에 맞춰 participant별 클라이언트 버퍼에 누적 (최소 3초 간격, 참가자당 최대 1,200포인트 ≈ 1시간). 서버 이력 API 없이 동작 — 페이지 새로고침 시 이력은 초기화됨 (BE 이력 API는 후속 과제)

## 실시간 표시 차분화
- 기존 SDD-028의 3초 구간 평균 로직 그대로 재사용 — 카드/상세 모두 1초 튀는 값 대신 평균값 표시
- 상세 패널 시계열도 동일 간격(3초) 스냅샷 갱신, 차트 애니메이션 비활성화

## 변경 파일
- 신규: `SessionPreJoinPreview.tsx`, `SessionParticipantCardGrid.tsx`, `SessionParticipantDetailPanel.tsx`, `lib/session-live/metric-display.ts`
- 수정: `pages/sessions/SessionLivePage.tsx`(프리뷰·토글·시계열 버퍼·상세 패널), `pages/sessions/SessionDetailPage.tsx`(시작 → 프리뷰 경유)
- BE: 변경 없음

## 검증
- `cd frontend && npm run build` — ✓ built, 0 error (tsc -b 포함)
- eslint(변경 파일) — 신규 파일 0 문제. `SessionLivePage.tsx`의 4 error/1 warning은 변경 전부터 존재하던 기존 이슈로 동일 유지
- `cd backend && venv/bin/pytest` — **656 passed, 12 skipped** (BE 무변경 확인)

## 비고 / 후속
- 스펙의 "집중도/이완도/스트레스" 표기는 현행 `SessionLiveMetric`이 제공하는 지표(두뇌휴식도=이완 계열, BPM, 호흡수)로 매핑 — 집중도/스트레스는 live-metrics 계약에 추가되면 카드·상세에 계열만 추가하면 됨
- 상태 변화 이력의 서버 보존(새로고침 복원)은 BE feature 이력 조회 API 신설 필요 — 후속 SDD 후보
- 영상/음성 저장 없음 (SDD-084 녹화 정책에서 별도 처리)
