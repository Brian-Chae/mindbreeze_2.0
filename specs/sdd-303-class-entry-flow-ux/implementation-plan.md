# SDD-303 — 통합 동의 구현 계획

**승인:** 2026-11-05 사용자: 동의 화면 통합까지 진행, 연결 코어는 유지하고 동의 처리 변경을 별도 검증.
**목표:** `/class/:sessionId/enter`의 기존 녹음 gate와 준비 a를 동일한 실제 서버 연결 통합 동의 화면으로 교체.
**구현:** Astra 단일 구현, root 독립 검증. 제품 코드 전 작성. 커밋·푸시·PR·배포 없음.
**근거 시안:** `303-v3-preview.html?state=first`, 기존 NoticeStepView의 상세 고지 전부 보존.

## 경계와 명시적 변경
- 보호 manifest 1,300개 파일 변경 금지. CodeEntry, BandStepContainer/View, useBand/useBandStep, member-machine, permission-guide, backend, native/eeg/measurement 불변.
- EntryPage의 hold 조건식, live EEG 전달, BandStepContainer의 연결/해제/완료 콜백 내용은 보존.
- 변경: 동의를 한 화면에서 명시 선택하고 제출 시 저장한다. 기존 연구 클릭 즉시 저장/리포트 실패 무시 동작은 통합 제출·실패 시 화면 유지로 바뀐다.
- 기존 GET entry/consents, GET research-consent, GET entry-state로 서버 상태 복원. 로컬값만으로 동의를 인정하지 않는다. 조회 실패 시 선택·저장 진행 불가, 재시도 제공.
- 기존 녹음 gate에서는 입장 POST로 녹음 동의와 자격을 먼저 취득. 입장 자격이 있어도 녹음 동의가 확인되지 않으면 기존 PUT entry/recording-consent 사용. 이미 유효한 녹음은 재저장하지 않는다.
- 연구·리포트·EEG는 기존 PUT 사용. 실제 회차 정보와 서버 선택을 사용자에게 보여 주고 확인받은 후, 선택 저장은 EEG부터 수행하여 후속 실패 때 사용자의 명시적 false를 보존한다. 모든 저장이 성공하기 전에는 자격을 부모에 공개하거나 밴드 준비로 넘어가지 않는다. 부분 성공은 원복했다고 표시하지 않고 성공 checkpoint로 동일 제출 재시도를 지원.
- guest 연구 미노출/미전송. bandMode none EEG 미노출/미전송. 서버 true/false/null/undefined를 구별하고 현재 버전 true만 체크 복원.
- 통합 저장 전에는 c 연결 UI를 열지 않는다. 통합 EEG 동의 true는 기존 c 연결 화면 그대로, false는 BandStepContainer를 mount하지 않고 기존 거절과 동일한 writeBandSkip(true), bandOutcome=skipped, next를 적용. c bypass는 이번에 허용된 동의 orchestration 변경이며 연결 코어 불변과 구분한다.
- 녹음 gate에서 통합 저장한 뒤에는 기존 confirm을 유지하고 a에 도달할 때 동일 폼 중복 표시만 1회 생략. a에서 제출한 경우 기존 next로 b 이동.
- 설문 b·온라인 기기 d·준비 요약 e·대기·시작·뒤로가기 상태 머신은 보존. 요약에서 a로 다시 갈 때 통합 화면으로 서버 선택을 새로 조회한다.
- 통합 화면에서 명시한 리포트 선택은 해당 회차 재확인 완료로 취급해 기존 c 리포트 재질문 시트는 반복하지 않는다. onDone 조건과 연결 결과 전달은 변경하지 않는다.

## 소유 파일
- 신규 `frontend/src/components/class/flow/member/IntegratedEntryConsent.tsx`: 조회/저장 수명·연타 잠금·부분 성공 재시도.
- 신규 `frontend/src/components/class/flow/member/IntegratedEntryConsentView.tsx`, `integrated-entry-consent.css`: 시안 UI와 기존 상세 고지.
- 신규 `frontend/src/lib/class/flow/integrated-entry-consent.ts`: 기존 endpoint typed 조회/저장 helper.
- 수정 `frontend/src/pages/class/EntryPage.tsx`: 기존 gate/a 렌더 연결, 성공값 반영, false c bypass.
- 신규 `frontend/tests/sdd303-integrated-consent.test.tsx`: 실제 API client 경계와 UI·수명·실패 테스트.
- 기존 관련 테스트는 변경된 UX 기대만 갱신. 기존 BandStep/hold 단위 테스트는 제품 변경 없이 회귀 실행.

## 구현 태스크
1. [x] 기존 동의 회귀 baseline 확인. 새 테스트를 먼저 작성하고 체크박스 5개·동의 저장·실패 유지·거절 c bypass가 현재 구현에서 실패하는 RED 증거 확보.
2. [x] GET/PUT helper 및 통합 controller 구현. 서버 복원, 녹음→EEG→연구→리포트 제출 순서, 미동의, guest/none, 실패와 재시도, 연타, 언마운트 후 다음 요청 차단 검증.
3. [x] 시안 카드/흰 unchecked/전체선택·부분선택/키보드/필수 gate 및 기존 상세 고지 UI 구현.
4. [x] EntryPage 기존 gate/a 연결 및 EEG false c bypass. true는 원래 BandStepContainer를 같은 c에 mount하고 직접 connect 호출 없음 확인.
5. [ ] 신규 테스트 GREEN, 기존 동의/entry 회귀, 타입/빌드, 보호 해시 재검증. baseline 전체 suite 결과와 구분.
6. [ ] 실제 React 화면 390×844·390×667·768×1024 캡처와 독립 리뷰. 실기기 BLE는 검증하지 않았음을 기록.

## 주요 실패 시나리오
- 지연 응답 중 뒤로가기/언마운트/회차 변경: 후속 저장·화면 이동 없음. 이미 서버가 받은 요청은 취소되었다고 주장하지 않음.
- 녹음 성공 후 연구/리포트/EEG 실패: 선택 유지·부분 저장 안내·재시도, 밴드 단계 이동 없음.
- 시작/종료/대기열 상태와 동의 저장 완료 경합: 서버 상태 머신의 종료/대기열 처리를 우회하지 않음.
- 기존 EEG true/false/null 및 구 버전: 명시 선택 복원 규칙 테스트, 미동의가 true가 되지 않음.
- 요약에서 선택 변경 시 기존 연결이 있는 EEG 철회는 코어 해제 변경 없이 처리하면 위험: EEG는 밴드 준비 시작 이후 화면에서 편집 잠금하고 설정 개인정보에서 변경 안내. c를 마운트하지 않고 false/skipped였던 경우만 다시 true를 선택할 수 있고 bandOutcome을 none으로 되돌려 기존 연결 화면을 사용할 수 있다. true로 c를 거친 skipped/connected는 잠금을 유지한다.

## 독립 리뷰 반영
- 자격 없는 첫 경로: `클래스 정보 확인하기`는 녹음 POST만 수행한다. 내부에 확보한 실제 classInfo와 기존 동의/연구/리포트를 조회하고 같은 화면에서 다시 확인받는다. 두 번째 제출에만 선택 저장 및 부모 자격 공개.
- 사용자가 조작한 항목만 보존하고 untouched 항목은 서버 복원. 조회 재시도에 녹음 POST 중복 없음. 초기 기본 false를 저장된 거절로 간주하지 않는다.
- 첫 POST 후 두 번째 확인 전 이탈하면 서버 녹음 및 계정 EEG 값이 존재할 수 있으므로 선택 저장 완료로 표시하지 않는다. 재입장 시 서버를 다시 조회한다.
- 실제 오프라인/명상 고지 표시 후에만 report noticeAcknowledged 전송. 초기 일반 고지로 class-team-v1 확인을 기록하지 않는다.
- false c 생략 후 d/e 뒤로가기는 b로 이동. fromSummary의 기존 복귀 계약 유지.
- 통합 조회와 제출 직전 상태조회에서 종료/취소이면 기존 상태 안내로 전환하고 쓰기 차단. 진행 중 요청 후 종료는 부모 unmount로 후속 저장 차단. 서버 원자성까지 변경한 것은 아니다.

- 미개방 대기에서 보존한 touched 선택은 통합 저장 성공 시 values와 함께 해제한다. 요약 재검토에서 서버 true를 초기 false로 덮어쓰던 사례를 RED로 재현한 후 수정했다.
