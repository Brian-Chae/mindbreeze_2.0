# SDD-303 — 구현 전 검증 계획

- 작성 시점: 2026-11-05, 제품 코드 변경 전.
- 사용자 승인: Astra 시안 승인 및 Astra 구현 지시. 최신 최우선 제약은 밴드 연결·Bluetooth·웹→네이티브 전환 및 기본 기능 불변. 코드 입력 화면 불변.
- 사용자 추가 승인: 동의 화면 통합까지 진행. 동의 조회·저장·진행 orchestration 변경을 별도 검증하며 연결 코어는 유지한다.

## 변경 전 기준
- `implementation-protected-baseline.json`: 기준 커밋과 1,300개 보호 파일 SHA-256. backend/native/eeg/measurement 및 CodeEntry, BandStep, member-machine, permission-guide 포함.
- 추적 제품 파일 diff 없음. 기존 untracked 디렉터리는 본 SDD 시안 산출물.
- 의존성: 일반 npm ci는 기존 Storybook 8/Vite 8 peer 충돌. 기존 CI와 같은 legacy-peer-deps 옵션으로 설치. package/lock 수정 없음.

## 필수 검사
- [x] 보호 파일 해시 1,300개 모두 동일. 기준 커밋과 변경 목록 직접 대조.
- [x] CodeEntryPage/CodeEntryView 및 코드 입력 UI 불변.
- [x] 밴드 연결 요청은 기존 사용자 제스처에서만 실행, 권한 안내/OS 요청/재연결 흐름 불변.
- [x] EEG true는 기존 c 연결 경로, false는 c 연결 UI 미마운트 + writeBandSkip(true) + bandOutcome skipped + 기존 next. hold 조건식·native adopt→JS release·live 시작/해제 불변. 동의 orchestration 변경과 연결 코어 불변을 별도 검증.
- [x] bandMode none/opt/req, 이미 연결/미연결/접촉 미확인/접촉 불량/미지원 경로 회귀.
- [x] 녹음 필수 동의 전 자격 발급 불가, 서버 동의 저장 실패 시 성공으로 표시하지 않음.
- [x] 기존 개인정보·녹음·연구 상세 고지·보관기간·철회 안내 보존. 합성 시안 문구로 실제 고지 대체 금지.
- [x] 전체 동의/전체 해제/개별 변경/일부선택 표시/키보드 Space 및 레이블 동작.
- [x] 미선택과 저장된 거절 구분, 이미 받은 동의를 다시 받은 것으로 기록하지 않음.
- [x] guest 연구 비노출, bandMode none EEG 비노출, AI flag/online/offline 고지 차이 유지.
- [x] 저장 연타·저장 지연·오류·뒤로가기·언마운트·기존 선택 유지 및 서버 payload 검증.
- [x] 승인 시안과 실제 React 화면 390×844, 390×667, 768×1024 비교. 체크박스 흰색·본문 스크롤·하단 CTA·가로 넘침 확인.
- [x] 신규 기능 RED→GREEN 테스트 기록. 기존 관련 회귀 검사 및 타입/웹 빌드.
- [x] 독립 리뷰: 구현자 Astra와 검증자 분리. 지적 수정 후 범위 재검증.

## 기준 회귀 테스트
`class-flow-member-machine`, `class-flow-member-band`, `sdd293-band-early-handoff`, `sdd222-band-reconnect`, `sdd246-web/t12-native-start`, `t13-native-start-decoupled`, `t14-native-no-reconnect-loop`, `native-measurement`.

## 검증 한계와 배포 경계
로컬 모의 API/네이티브 테스트는 실기기 BLE·iOS/Android 권한·프로덕션 인계를 입증하지 않는다. 실제 기기 시험 없이 민감한 흐름의 배포 준비를 단정하지 않는다. 이번 세션의 구현 승인은 푸시·PR·배포·메일·삭제를 자동으로 수행하라는 지시로 확대하지 않는다. 먼저 코드·리뷰·검증 결과를 구체적으로 제시한다.

## 변경 전 실행 기록
8개 파일 101개 테스트 assertion 통과. SDD-293 종료 callback unhandled TypeError 1건으로 exit 1, 전체 통과 판정 불가. 상세는 implementation-safety-plan.md. 제품 diff 0 유지.

## 승인된 통합 동의 추가 검증(제품 구현 전)
- [x] 첫 녹음 gate 전체+필수+EEG+연구+리포트 5개 체크박스, 필수만 선택 가능.
- [x] 기존 자격: 서버 동의/연구/리포트 조회 후 true/false 복원, 조회 실패 재시도.
- [x] 기존 endpoint의 credential/participant/version payload 유지. 녹음 유효 동의 재기록 0.
- [x] 부분 저장 실패·재시도·연타 시 중복 진행 0, EEG 저장 완료 전 연결 0.
- [x] 언마운트 후 후속 API/화면 전이 0.
- [x] EEG false의 c bypass가 skipped/skip 기록/hold false를 만들고 connect 호출 0.
- [x] EEG true의 c 콜백/연결 제스처·hold 표현식 원문 보존.
- [x] guest 연구/none EEG 미노출·미전송, 기존 선택/버전/누락 구별.
- [x] 상세 녹음·연구·명상 열람 고지/보관/철회·AI flag와 온라인 차이 보존.
- [x] 기존 confirm/b/d/e는 유지되며 단계 축소 전체 완료로 보고하지 않음.

## 독립 리뷰 추가 시나리오
- [x] entry=null 첫 제출은 녹음 자격 확인만. 실제 회차 metadata/서버 동의 복원 후 재확인까지 선택 PUT/부모 자격 저장 0.
- [x] EEG false c 생략 후 뒤로가기는 설문으로 복귀하며 제자리 루프 없음.
- [x] c를 열지 않은 false/skipped는 true 재선택 가능, c를 거친 true/skipped/connected는 편집 잠금.
- [x] 종료와 동의 403 동시 응답은 종료 안내 우선. 비초대 403은 기존 코드 입장 복구 화면.
- [x] 미개방 대기 후 통합 저장 성공·요약 재검토에서 pending touched가 서버 선택을 덮어쓰지 않음. 신규 22개 포함 최종 8파일 105테스트 PASS.

## root 최종 실행 결과
위 체크 표시는 소스 대조·로컬 단위/합성 API/브라우저 검증 범위다. 실기기 결과가 아니다. 신규 22개 독립 재실행 PASS, 구현자 8파일 105테스트 PASS, 최종 npm run build(타입 포함) exit 0, 보호 파일 1,300개·hold/BandStep 원문 동일. 코드 입력 390/768 픽셀 차이 0. 연결 회귀는 101 assertion 통과와 기존 unhandled error 1건을 함께 기록하며 전체 통과로 표기하지 않는다. 상세 증거와 미검증 범위는 summary.md를 따른다.

## A안 전체 구현 시나리오 (구현 전 작성, 11/5 범위 정정)
설계: 마법사 = 동의(a) → 밴드(c, 밴드 사용 회차만) → 대기실. 입장 확인(confirm)은 열린 회차면 자동 통과, 상태 질문(b)·기기 점검(d)은 대기실의 선택 항목, 준비 요약(e)은 제거.
탭 수는 vitest 클릭 횟수로 실측한다(OS 권한 P·숫자 입력 제외).

### 단계 구성·머신
- [ ] A-1 buildSteps: 밴드 사용 회차 `['a','c']`, 밴드 없음 회차 `['a']`(온라인/오프라인 동일).
- [ ] A-2 open 회차 + 자격 있음 → 입장하기 클릭 없이 동의 화면(a)으로 자동 진입(0탭). 동의 화면에서 이전 → 입장 확인 화면으로 돌아와도 자동으로 다시 넘어가지 않음(취소 수단).
- [ ] A-3 unopened 회차는 자동 통과하지 않고 "열리면 자동으로 입장해요" 대기 유지. 열리면 동의 화면으로.
- [ ] A-4 마지막 단계 완료 → 곧바로 대기실(요약 화면 없음).
- [ ] A-5 대기실에서 `오늘의 상태`·`기기 확인`·`선택 바꾸기` 진입 → 완료/이전 시 대기실 복귀(wait→wizard→wait). 시작 신호는 어느 쪽에서도 live 전환.

### 동의 완결성
- [ ] A-6 서버에 필수+EEG+연구(회원)가 현행 고지 버전으로 이미 확정이면 동의 화면을 건너뜀(PUT 0, 같은 값으로 상태 파생: eeg/report/research/prep.reportChoice).
- [ ] A-7 EEG 미결정이거나 연구 미결정(회원)이면 건너뛰지 않고 화면 표시. 게스트는 연구 제외 기준.
- [ ] A-8 건너뛴 경우에도 `eegChoice` 파생(밴드 단계 노출·hold·MemberClassContainer eegConsent)이 저장 경로와 동일.
- [ ] A-9 EEG 거절이면 밴드 단계를 열지 않고(connect 0) 대기실로.
- [ ] A-10 동의 화면 건너뜀은 이전→동의 화면 표시로 되돌아와도 루프 없음.

### 중복 버튼·시트 제거
- [ ] A-11 EEG 선택 화면 문구 `선택 저장하고 계속`("동의하고 LINK BAND 연결하기" 0건).
- [ ] A-12 PermissionGuide `inline` 모드: 설명이 화면에 보이고 연결 1탭이 곧바로 onConnect(시트 0, "확인하고 계속" 0). 기본 모드(설정·상담사 시트)는 불변.
- [ ] A-13 리포트 재확인 시트 제거: 밴드 연결 후 어떤 경우에도 해당 시트 0, 리포트 값 덮어쓰기 0.
- [ ] A-14 접촉 양호(leadOff 확정, ch 모두 정상)로 연결되면 약 1.5초 뒤 자동 다음(탭 0). 접촉 미확인(leadOff null)·불량은 자동 진행하지 않고 수동 `다음`. 자동 대기 중 이전/없이 계속하기 가능, 언마운트 시 타이머 해제.

### 웹→네이티브 인계
- [ ] A-15 자동·수동 다음 모두 bandOutcome=connected 로 기록 → 기존 hold 훅 want 조건(bandDone, c 단계 이탈 후) 그대로 충족. 대기실에서 인계가 10초 넘게 확정되지 않으면 한 줄 안내와 `밴드 다시 연결` 진입점(JS 연결은 인계 확정 전 유지 — adoptBand 불변).
- [ ] A-16 SDD-293/298/300/301 시험 불변 통과.

### 준비 현황(호스트 로비)
- [ ] A-17 상태 질문·기기 점검이 선택 항목이므로 미실시는 `건너뜀` 으로 중계(readiness 에서 done+skipped), 밴드 결과가 아직 없으면 준비 완료로 보지 않음.

### 탭 수 실측 표 (summary 에 기록)
| 조건 | 시험 |
|---|---|
| 오프라인·밴드 새 연결(접촉 확인 자동) | 동의 체크 K + 저장 1 + 연결 1 |
| 밴드 미사용 선택 | 동의 K + 저장 1 + 밴드 없이 1 |
| bandMode=none | 동의 K + 저장 1 |
| 모든 선택 유효·밴드 새 연결 | 연결 1 |
| 재입장·유효 동의·미사용 기록 | 0 |
