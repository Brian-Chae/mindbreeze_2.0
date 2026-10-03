# SDD-099 — 호스트 클래스 이식 구현 계획

> 구현 에이전트: `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 태스크를 순차 실행한다. 구현 전 `verify.md` 승인이 필요하다.

**목표:** 정본 목업의 시각 디자인과 인터랙션을 실제 호스트 화면으로 이식한다.

**구조:** ClassPlayerPage는 기존 훅·상태 전이·미디어 생명주기를 계속 소유한다. 호스트 표시 모델에서 실제 측정값과 시계열을 결합하고, CSS는 `.host-class-player` 아래로 한정한다. 기존 공용 회원 컴포넌트에 호스트 전용 스타일을 전역 적용하지 않는다.

**기술:** 현재 저장소의 React/TypeScript/Vite/Vitest와 기존 SVG·CSS.

**스펙:** `specs/099-host-class-player/spec.md`

## 공통 제약

- 목업 HTML과 폰트는 수정하지 않는다. 사용자 미추적 디렉토리를 보존한다.
- `any` 금지. API·소켓 서버 계약 변경 금지. null과 0 구분.
- 확인되지 않은 데이터·3분 변화·막대 시계열을 생성하지 않는다.
- 코드 변경의 핵심 산출물은 ClassPlayerPage.tsx와 host-class-player.css이다.
- 지표·정렬의 독립 검증이 필요하면 호스트 전용 순수 헬퍼와 테스트를 추가한다.

## 리뷰 집중 항목

1. 참가자/세션/run 전환으로 다른 사람이나 이전 회차의 시계열이 섞이지 않는가.
2. 밴드 미사용·리드오프·stale·null을 정상 데이터나 0으로 표시하지 않는가.
3. 그룹 기준선 상대 집계와 정규화된 개인 점수 평균을 혼용하지 않는가.
4. 10초 표시 순환이 사용자가 선택한 정렬 기준을 변경하지 않는가.
5. 오버레이·몰입 전환에서 미디어 훅 재마운트나 불필요한 녹음 중단이 없는가.

## 작업 1 — 여섯 지표 표시·시계열·정렬

파일: ClassPlayerPage.tsx, 필요 시 `frontend/src/lib/class/host-class-metrics.ts`,
`frontend/tests/host-class-metrics.test.ts`.

- [ ] 테스트로 0/null, 미착용, stale, 리드오프, 179/180초, 동률 입장순, 정렬 입력 불변성을 고정한다.
- [ ] 기존 rows 패치 처리는 유지하고 feature에서 누락 지표를 참가자 ID·회차별 표시 상태에 보관한다.
- [ ] 정상 최신 표본만 시계열에 누적한다. 참가자별 실제 측정 이력으로 3분 대비를 계산한다.
- [ ] 카드 기본 정렬은 이완도, 개별 칩 선택 시 해당 지표, 자동 순환은 표시 지표만 변경한다.
- [ ] 테이블은 입장순에서 시작하여 헤더 현재값 오름/내림차순, 참가자 헤더로 초기화한다.
- [ ] `npx vitest run tests/host-class-metrics.test.ts`로 실제 데이터 경계 사례를 검증한다.

## 작업 2 — 호스트 셸·신호·미디어·그룹 흐름

파일: `frontend/src/pages/sessions/ClassPlayerPage.tsx`,
`frontend/src/components/class/host-class-player.css`.

- [ ] 정본의 최종 CSS cascade와 760px 분기 기준으로 2칼럼·모바일 배치를 이식한다.
- [ ] 색 토큰, 신호 3행/글리프/배지/미확인 pill, 미디어 제어·셀프뷰·시간을 구현한다.
- [ ] recordSignal/countSignals의 10초 만료와 참가자별 중복 처리 계약을 유지한다.
- [ ] 여섯 지표 링·막대는 실제 표시 모델 및 유효 시계열에 연결한다. 표본 부족 시 대기를 표시한다.
- [ ] 기존 녹음·녹화 핸들러, 동의, 채팅, BGM, 발언권, 큐시트, 마커에 대한 접근 경로를 유지한다.

## 작업 3 — 참가자 카드·테이블·상세

파일: 작업 2와 동일. 실제 자료 조회가 필요한 경우 기존 API 함수를 재사용한다.

- [ ] 한 행 5개 카드와 [모두] 테이블, 단일 칩 선택·10초 순환을 연결한다.
- [ ] 참가자 ID를 키로 상세 선택을 유지하고, 퇴장·세션 변경 때 선택을 정리한다.
- [ ] 사전 설문·성별·나이는 확인된 자료만 표시하며 제공되지 않으면 정보 없음으로 표시한다.
- [ ] 상세에 마음 링·몸 막대·범례를 표시하고 버튼·바깥·Esc 닫기와 포커스 복귀를 구현한다.
- [ ] 390px에서 스크롤로 테이블에 접근 가능하고 상세 닫기가 화면 밖으로 벗어나지 않는지 검증한다.

## 작업 4 — 회귀 검증·기록

- [ ] `npx vitest run tests/host-class-metrics.test.ts tests/quiet-signal.test.ts tests/group-aggregate.test.ts tests/class-chat-panel.test.ts`.
- [ ] `npm run build` 실행 후 tsc·vite 종료 코드 0 확인.
- [ ] 1280×900 / 390×844에서 목업과 실제 페이지 캡처를 비교하고 overflow·상세·칩·정렬을 확인한다.
- [ ] 시작/일시정지/재개/종료 2단계, 이탈 취소, 밴드 없는 참여와 채팅·미디어 유지 여부를 검증한다.
- [ ] 결과와 미검증 하드웨어 항목을 `summary.md`에 기록하고 최종 리뷰에 전달한다.

## 변경 전 빌드

2026-10-03 `npm run build` 성공(tsc + vite, 종료 코드 0).
기존 경고: design-system tokens.css import 해석 실패 메시지, 500kB 초과 청크.
이 결과는 이식 후 검증 결과가 아니다.
