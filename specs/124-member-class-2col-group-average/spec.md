# [SDD-124] 회원용 클래스 뷰 2열 재구성 + 절대 그룹 평균 실시간 브로드캐스트

## Goal
회원(내담자) 클래스 뷰를 상담사 뷰와 동일한 2열 디자인 언어로 재구성하고, 밴드 착용자들의 **절대 그룹 평균**을 실시간으로 회원에게 브로드캐스트해 "그룹 평균 대비 내 위치"를 보여준다.

## Context
- SDD-123에서 회원 클래스 뷰의 지표 다이얼(MemberMetricDial)과 조용한 신호(Lucide 아이콘)를 개선·배포 완료.
- Brian 요구: 회원 뷰도 상담사 뷰와 같은 레이아웃 언어로 + **그룹 평균 대비 내 위치**를 실시간 노출(모두가 궁금해하는 핵심 지표).
- 디자인 목업 `design/member-class-player/index.html` 확정: 2열(좌 30% / 우 70%), 우측 상단 MIND 3 + BODY 3(2행), 하단 디바이스 상태 + raw(EEG·PPG·ACC), 비율 3:2.
- 기존 `class:aggregate`는 **상담사 전용**(baseline 상대값 50=기준선, 이완·집중 2지표, 점수 경쟁 방지 설계). Brian이 제품 기획 변경을 결정: **절대 그룹 평균을 회원에게 노출**.

## Scope

### ✅ In-scope
- **Backend**: 신규 WS 이벤트 `class:group_average` — 밴드 착용자의 최근 구간 절대 그룹 평균(6지표)을 익명 집계해 `_room_all`(호스트+전체 참가자)로 브로드캐스트.
- **Frontend**: 회원 클래스 뷰 2열 재구성(좌: "지금 나를 알려요" 시그널 + 상담사 영상 + 함께한 시간 / 우: 지표 + 디바이스 상태 + raw 파형).
- **Frontend**: 각 지표 다이얼에 그룹 평균 마커(내 값 vs 그룹 평균) 표시.
- **Frontend**: raw 데이터(EEG 2ch·PPG·ACC) 실시간 파형 렌더(밴드 연결 시).
- **Frontend**: 디바이스 상태 스트립(배터리·접촉·신호 품질·연결 시간).

### ❌ Out-of-scope
- 상담사(호스트) 뷰 변경 없음 — 기존 `class:aggregate` 계약 유지.
- 리포트·기록지에 그룹 평균 영속화 없음(실시간 표시 전용).
- EEG/PPG/ACC raw 데이터 영속화 방식 변경 없음(스트리밍만, 밴드 끊김 시 해당 구간 유실 기존 정책 유지).
- 셀프 트레이닝·MVP3 범위.

## Acceptance Criteria
- [ ] 회원 클래스 뷰가 2열(좌 30% / 우 70%)로 렌더링되고, 우측 상단에 MIND 3 + BODY 3가 2행으로 모인다.
- [ ] 우측 하단에 디바이스 상태 + raw(EEG·PPG·ACC)가 3:2 비율로 표시된다.
- [ ] 밴드 연결 시 EEG(2ch)·PPG·ACC 파형이 실시간으로 렌더된다.
- [ ] 6지표 각각에 "그룹 평균" 마커가 실시간 표시되고, 표본 부족(<MIN_WEARERS) 시 "표본 부족"으로 흐리게 표시된다.
- [ ] 그룹 평균 payload에 개인 식별자·개인 점수·순위가 포함되지 않는다(익명성 유지).
- [ ] `cd frontend && npm run build` 0 errors / `npx tsc --noEmit` 0 errors.
- [ ] `cd backend && pytest` 통과(신규 테스트 포함).

## Dependencies
- SDD-123: `MemberMetricDial`, `QuietSignalButtons`, `lucide-react`, `member-class-player.css`.
- `useBand`: raw 파형(`eegWaveform`/`ppgWaveform`/`acc`) + `scoredIndices` + 배터리/접촉/신호.
- `useSessionLiveSocket`: WS 콜백 패턴(`class:aggregate` 구독과 동일 구조).
- Backend: `group_aggregate.py`(MIN_WEARERS·윈도우 조회 패턴), `session_live_namespace.py`(룸 구조·throttle).

## Risks
- **점수 경쟁 유도**: 그룹 평균 노출은 기존 "경쟁 방지" 설계 반전 → MIN_WEARERS 익명 게이트 유지 + 개인 식별자/점수 payload 미포함으로 완화.
- **raw 250Hz 렌더 성능**: rAF + supplier 패턴(React 리렌더 0) 재사용으로 회원 뷰 부하 최소화.
- **HRV 스케일 불일치**: 회원은 `sdnn`, 호스트는 `rmssd` 사용 → 회원 그룹 평균은 **sdnn** 평균으로 통일(자기값과 동일 스케일).
- **마음 지표 raw(0~1) vs 표시(0~100) 불일치**: 백엔드는 raw 평균(0~1)을 내려주고, 프론트가 자기값과 동일한 `scoreIndices`로 정규화해 비교 — 정규화 함수 단일화로 오차 제거.
