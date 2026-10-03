# SDD-099 — 호스트 클래스 목업 React 이식

작성일: 2026-10-03. 상태: 구현 전 검토.

## 목표와 범위

사용자가 지정한 `design/host-class-player/index.html`을 디자인 정본으로 삼아
`frontend/src/pages/sessions/ClassPlayerPage.tsx`의 호스트 진행 화면을 이식한다.
기존 API·소켓 계약과 세션 상태 전이, 녹음·녹화·밴드·채팅 기능은 유지한다.
새로운 서비스 기획이나 백엔드 계약 변경은 범위에 포함하지 않는다.

## 수락 기준

- 좌측 조용한 신호·미디어 제어·호스트 셀프뷰·함께한 시간, 우측 그룹 흐름·참가자 목록의 2칼럼 구성.
- 신호 3행, 단색 원형 글리프, 28px 보라 배지, 응답 인원·최근 10초·미확인 pill.
- 마음 3지표 링과 몸 3지표 막대, 실제 값·단위·3분 대비 증감·유효 표본 표시.
- 데스크탑 참가자 카드 한 행 5명. 이름·성별·나이·큰 지표·증감·밴드 상태 표시.
- 기본 이완도, 개별 칩 단일 선택, 10초 표시 순환, 모두 선택 시 테이블.
- 카드 자동 정렬과 테이블 수동 정렬 분리. 3분 전 현재값, 이후 변화량, 동률 입장순.
- 참가자 상세는 roster 내부 오버레이. 사전 설문·마음 링·몸 막대·범례. 버튼·바깥·Esc로 닫기.
- 1280px/390px 반응형, 목업 토큰 유지, base64 폰트 제외, 새 CSS는 호스트 영역에 한정.
- `any` 없이 명시적 타입 사용, `npm run build` 통과.

## 코드 조사로 확인한 제약

1. `SessionLiveMetric`에는 이완도(raw), BPM, 호흡수만 있다. 집중도·정서안정도·HRV를 이 응답에 있다고 가정하지 않는다. 기존 `SessionLiveEegFeatureEvent.feature`의 `focus_index`, `emotional_stability`, HRV 필드를 별도 표시 모델에 연결하며 미수신은 null이다.
2. `scoreIndices`의 기존 정규화 의미를 유지한다. 미수신 값을 점수 함수의 기본값으로 채우거나 스트레스의 역수를 정서안정도로 만들지 않는다.
3. `ClassAggregateEvent`는 개인 기준선 대비 집중도·이완도 집계이다. 참가자 절대 점수 평균과 의미가 다르므로 서로 대체하지 않는다. 서버 표본 부족 판정을 유지하고 여섯 지표 평균은 동일한 유효 측정 표본에서 계산한다.
4. 기존 시계열은 이완도·BPM·호흡수만 누적한다. 6지표 시계열과 실제 3분 측정 충족 여부를 추가해야 하며, 클래스 경과 시간만으로 늦게 입장한 참가자를 유효 표본으로 간주하지 않는다.
5. `SessionParticipant`에는 성별·생년월일·사전 설문이 없다. 기존 권한 있는 데이터 경로로 확인된 값만 표시하고, 미제공 값은 정보 없음으로 표시한다. 목업의 인물·설문을 복사하지 않는다. 종료 후 체크인과 사전 설문을 혼동하지 않는다.
6. 이 페이지에는 몰입·코치마크 구현이 발견되지 않았다. 기존 회원 화면의 관련 구현을 변경하지 않으며 호스트에서 필요한 목업 인터랙션을 별도로 연결한다.

## 보존 대상

`useBand`, `useLiveKit`, `useSessionLiveSocket`, `useWaitingRoomCount`, `useLeaveGuard`,
`useAudioRecorder`, `useVideoRecorder`, `scoreIndices`, `applyEegFeatureToMetricsDetailed`,
signal-status, recordSignal/countSignals, ClassChatPanel, 발언권, 큐시트, BGM, 마커,
밴드 미착용·리드오프·미지원 브라우저 안내, ready/scheduled→open→in_progress/paused→completed,
종료 2단계 확인과 이탈 가드.

## 승인 게이트

AGENTS.md의 Stage ③에 따라 `verify.md` 승인 후 구현한다.
현재 작업에 대한 Verify 승인 기록은 확인되지 않았다.
