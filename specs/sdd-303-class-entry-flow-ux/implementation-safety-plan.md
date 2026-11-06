# SDD-303 — 승인 이후 안전 구현 범위 검토

- 작성일: 2026-11-05
- 상태: 실제 동의 통합과 처리 순서 보존 사이의 범위 선택 대기. 제품 수정 전.
- 사용자 승인: Astra 디자인 승인 및 Astra 개발 지시. 연결·Bluetooth·웹→네이티브 전환 및 기본 기능 불변 최우선.

## Astra 조사 결론
현재 녹음 동의는 credential 발급 이전 enter 요청, 연구는 a 단계 클릭 즉시 저장, 리포트는 a 단계 계속 시 저장, EEG는 c 단계에서 저장 성공 후 밴드 관찰 활성화 또는 미사용 진행으로 이어진다. 다섯 항목의 첫 화면 통합은 BLE 프로토콜 수정과는 별개지만 동의 처리 순서 및 밴드 준비 입력 변경을 동반한다. 보호파일을 유지하는 것만으로 실행 동작 불변을 주장할 수 없다.

## 선택 1: 처리 순서 그대로, UI 개선
- NoticeStepView.tsx + notice-step.css: 기존 onReportChoice/onResearchChange/onNext를 유지하며 리포트·연구만 전체 선택과 체크박스로 통일.
- RecordingConsentGateView.tsx + 전용 CSS: checked/submitting/error/onConfirm 보존. 코드 입력에서도 쓰는 공용 RecordingConsentCheck는 수정하지 않는다.
- EegConsentChoiceView.tsx + 전용 CSS: 체크박스+계속 버튼은 기존 onAgree/onDecline 호출. 저장 이후 연결/스킵 순서 보존.
- EntryPage/useEntryPrep/API/BandStep/상태 머신/코드 입력/연결 코어 변경 0.
- 실제 다섯 항목 통합·단계 축소는 미적용임을 명시한다.

## 선택 2: 통합 동의까지 구현
동의 orchestration 변경을 허용하는 범위가 필요하다. 연결 코어를 보존하더라도 저장/에러/복원/기동의/거절 및 밴드 준비 입력을 별도 검증하는 plan/verify 보완 후 실행한다. 실기기 인계 시험 없이 배포 준비를 단정하지 않는다.

## 구현 순서
1. 범위 확정 내용을 spec/plan/verify에 기록.
2. Astra: 신규 사용자 행동과 기존 저장 계약의 실패 테스트 작성·RED 확인.
3. Astra: 지정 파일에서 최소 구현·GREEN 확인.
4. 감독: protected manifest + diff + 기존 회귀 + 실제 React 렌더 캡처로 독립 검증.
5. 별도 리뷰어: 요구 충족·민감 실행 경로 불변 검토.
6. summary.md 결과/제한 기록 후 검토 가능한 변경으로 제시. 푸시·PR·배포·삭제·메일은 실행하지 않음.

## 변경 전 검사 결과
의존성 설치: npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund. CI의 legacy-peer-deps 설정과 일치, lock 변경 없음.
밴드/머신/인계 기준 8개 테스트 파일: 101 assertions PASS, unhandled error 1건으로 프로세스 exit 1.
오류: `TypeError: releaseRef.current(...)?.catch is not a function`, `useCloseBiosignalOnEnd.ts:25`, `sdd293-band-early-handoff.test.tsx`의 종료 순서 테스트. 변경 전 baseline이며 원인·수정 미확정. 민감 제품 코드를 임의 수정하지 않음.
