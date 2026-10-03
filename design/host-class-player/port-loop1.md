# 루프1 — 목업 디자인 → ClassPlayerPage.tsx React 이식

당신은 React 엔지니어입니다. `design/host-class-player/index.html`(호스트 클래스 디자인 정본 목업)의 디자인을 실제 상담사 클래스 진행 화면 `frontend/src/pages/sessions/ClassPlayerPage.tsx`에 이식하세요.

## 목표
목업의 **시각 디자인·레이아웃·인터랙션**을 실제 React 화면으로 충실히 재현하되, 기존 데이터 계약·기능은 그대로 유지한다.

## 1. 이식할 디자인 (목업 index.html 그대로)
1. **2칼럼 그리드**: 좌(조용한 신호 카드 · 미디어 제어 · 셀프뷰 "나의 화면·호스트" · 함께한 시간) + 우(그룹 흐름 · 참가자 카드)
2. **조용한 신호 카드**: 좌측 최상단, 세로 3행(단색 글리프 check-circle/help-circle/pause-circle + 라벨 + 보라 원 숫자 뱃지 28px), "응답 N·N명", "익명·최근 10초", 행 헤어라인. "미확인 새 신호 N건"은 우측 상단 pill(빨간 점)
3. **그룹 흐름**: **마음 MIND**(집중도·이완도·정서안정도 % → 링 게이지 + 중앙 숫자 + 증감) + **몸 BODY**(BPM·호흡수·HRV → 막대 그래프 + 값·단위 + 증감). "지난 3분 평균 대비" + "유효 표본 N명"
4. **참가자 카드**: 컴팩트, 이름·성별·나이 + 현재 지표 숫자 초대형 + "+N 3분대비" + 밴드 상태 dot, 한 행 5명
5. **chip**: [모두]→테이블 / 개별 1개 단일 선택(기본 이완도, 10초 순환)
6. **상세 슬라이드**: 카드/테이블 행 클릭 → 우측 오버레이(roster 영역), 헤더 + **사전 설문** + 마음 MIND(링) + 몸 BODY(막대) + 범례 1줄. 닫기(버튼·바깥·Esc)
7. **정렬**: 카드 자동(기본 이완도)/테이블 수동, 3분 미만/이후

## 2. 보존 (기존 ClassPlayerPage.tsx 기능·데이터 계약)
- useBand / useLiveKit / useSessionLiveSocket / useWaitingRoomCount / useLeaveGuard / useAudioRecorder / useVideoRecorder 등 훅
- scoreIndices / applyEegFeatureToMetricsDetailed / signal-status 로직
- **6대 지표 = 몸3(BPM·호흡수·HRV) + 마음3(집중도·이완도·정서안정도)**
- 채팅(ClassChatPanel) · 몰입 · 코치마크 · 리드오프 · 조용한 신호(recordSignal/countSignals) 기능
- LINK BAND 미착용 가드(bandConnected)
- 상태 전이(ready/scheduled→open→in_progress/paused→completed), 종료 2단계 확인

## 3. CSS
- 목업 CSS 토큰: --bg #12081C · --purple #5F0080 · --cream #F7F4F0 · --muted #bcaec5 · --lavender #dcb5ee · --border-container #ffffff1A · --border-divider #ffffff0D
- 새 CSS 파일(예: `frontend/src/components/class/host-class-player.css`)에 호스트 클래스 스타일 작성 후 import
- 목업의 Pretendard base64 폰트는 제외(기존 앱 폰트 사용)

## 4. 주의
- 목업의 **시연용 고정 데이터**는 실제 데이터 계약(live metrics/aggregate)으로 대체
- 반응형: 데스크탑 1280 / 모바일 390 (목업의 미디어쿼리 로직 반영)
- `npm run build`(tsc+vite) 통과 필수. `any` 금지, 명시적 타입.

## 산출
- 수정된 ClassPlayerPage.tsx + 새 CSS 파일
- 빌드/타입 검증 통과
