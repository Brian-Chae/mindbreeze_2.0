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
