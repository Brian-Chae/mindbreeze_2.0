# SDD-303 — Astra 구현 보고

2026-11-05. 제품 변경 완료, 독립 최종 검증은 root가 수행한다. 커밋·푸시·PR·배포·메일·삭제는 수행하지 않았다.

## 구현 결과

- `/class/:sessionId/enter`의 녹음 gate와 준비 a에 실제 서버 연결 통합 동의 화면을 적용했다. 전체 → 필수 → EEG → 연구 → 리포트 체크 방식, 흰색 미선택 체크박스, 기존 상세 고지와 개인정보 링크를 유지했다.
- 서버의 현재 버전 동의/거절을 복원한다. 연구의 false+고지 버전 없음은 저장된 거절과 구분한다. 조회 실패는 false로 바꿔 진행하지 않는다.
- 자격 없는 첫 방문은 `클래스 정보 확인하기`로 녹음 동의·입장 자격을 내부 확보하고, 실제 회차 정보와 서버 선택을 보여 준 뒤 같은 화면에서 한 번 더 확인받는다. 이 확인 전에는 선택 동의 PUT·부모 자격 공개·a 생략을 하지 않는다. 최초 기본값 false로 기존 연구/리포트 true를 덮어쓰지 않는다.
- 제출 시 기존 endpoint로 필요한 녹음 → EEG → 연구 → 리포트 순서로 저장한다. 부분 성공을 원복했다고 표시하지 않으며 실패한 항목을 재시도한다. 연타 잠금, 지연·언마운트 후 후속 저장/전이 차단, 종료/취소 우선 처리와 비초대 코드 입장 복구를 추가했다.
- EEG true는 기존 c 연결 화면을 그대로 사용한다. false는 c 연결 UI를 마운트하지 않고 writeBandSkip(true)/bandOutcome=skipped/next를 기록한다. c를 생략한 뒤 이전은 b로 복귀한다.
- c를 열지 않은 false/skipped는 true 재선택이 가능하다. true로 c를 이미 거친 skipped/connected는 코어 소유권 변경을 피하기 위해 이 화면에서 EEG 편집을 잠근다.
- 입장 확인·설문 b·온라인 기기 d·준비 요약 e·대기·시작 흐름은 유지한다. 전체 단계 축소를 구현한 결과가 아니다.

## 수정 파일

제품:
- `frontend/src/pages/class/EntryPage.tsx`: 통합 동의 연결, 결과 반영, false c 생략/뒤로가기, 미개방 선택 보존 및 성공 후 해제.
- `frontend/src/components/class/flow/member/IntegratedEntryConsent.tsx`: 자격/서버 선택 조회, 부분 저장·재시도·수명 관리.
- `frontend/src/components/class/flow/member/IntegratedEntryConsentView.tsx`: 승인 시안 기반 통합 폼과 기존 상세 고지.
- `frontend/src/components/class/flow/member/integrated-entry-consent.css`: 통합 화면으로 범위를 제한한 스타일.
- `frontend/src/lib/class/flow/integrated-entry-consent.ts`: 기존 GET/PUT endpoint만 사용하는 타입 지정 어댑터.

테스트:
- 신규 `frontend/tests/sdd303-integrated-consent.test.tsx`: 통합 UI·서버 상태·부분 실패·연타·언마운트·밴드 분기·종료·미개방 등 22개 시나리오.
- `class-flow-member-entry-page.test.tsx`: 통합 조회 fixture/제출 저장/실패 유지/명시적 리포트 선택 후 재질문 없음 계약으로 갱신. 기존 재확인 시트 두 테스트를 새 계약 한 테스트로 대체했고 무효 클릭을 정리했다.
- `class-flow-member-live.test.tsx`, `sdd222-entry-page-background.test.tsx`: 통합 GET fixture와 새 CTA를 사용하도록 갱신. 기존 live/종료/백그라운드 검증은 유지.
- `entry-page-not-open-consent.test.tsx`: 새 필수 체크와 첫 자격 확인 CTA로 갱신. 기존 409 미개방 처리 검증 유지.

보호 파일은 수정하지 않았다. `useEntryPrep`, 기존 Notice/Recording/Eeg 개별 뷰, API class-flow 어댑터, 밴드 코어, 상태 머신, 코드 입력 UI, backend/native/eeg/measurement는 원문 보존했다.

## RED → GREEN 근거

- `sdd303-red.log`: 기존 제품에서 신규 9개 테스트 모두 의도한 기능 부재로 실패.
- `sdd303-edge-red.log`: 오류 포커스 누락 재현 → 오류 focus/nearest 스크롤.
- `sdd303-terminal-red.log`: 종료가 일반 조회 오류로 숨겨지는 경우 및 저장 직전 취소 재현.
- `sdd303-metadata-back-red.log`: 자격 없는 첫 방문의 metadata/기동의 복원 누락과 false c 뒤로가기 루프 재현.
- `sdd303-terminal-auth-red.log`: 종료+동의 403 우선순위와 녹음 선검사 뒤 비초대 복구 재현.
- `sdd303-research-red.log`: 미선택과 저장된 연구 거절 구별 누락 재현.
- `sdd303-reselect-red.log`: c 미진입 false/skipped에서 true 재선택 불가 재현.
- `sdd303-touched-red.log`: 미개방 보류 선택이 저장 후 요약 재검토의 서버 true를 false로 덮어쓰는 문제 재현 → 성공 시 values/touched 함께 초기화.

최종 구현자 실행:

```sh
cd frontend
npm test -- --run tests/sdd303-integrated-consent.test.tsx tests/class-flow-member-entry-page.test.tsx tests/class-flow-member-prep.test.tsx tests/entry-page-not-open-consent.test.tsx tests/entry-page-notyet-retry.test.tsx tests/sdd220-auth-consents.test.tsx tests/class-flow-member-live.test.tsx tests/sdd222-entry-page-background.test.tsx
```

**8개 파일 · 105개 테스트 PASS, exit 0.** `sdd303-final-regression.log` (18:09:38 실행, 18.74초).
`npx tsc -b` PASS (`sdd303-typecheck.log`, 최종 touched 초기화 1줄 이전 검사). `git diff --check` PASS. 최신 빌드/타입과 독립 보호 파일 검사는 root 최종 결과를 따른다.

## 기준 실패와 한계

- root의 변경 전/후 밴드 코어 회귀는 8개 파일 101개 assertion 통과이나, 기존 SDD-293 callback mock의 `releaseRef.current(...).catch` TypeError 1건으로 exit 1이다. clean-green으로 보고하지 않는다. 보호 제품 코드를 이 오류 때문에 수정하지 않았다.
- root의 전체 suite baseline은 기존 nav-labels-characterization 5실패와 종료되지 않는 실행으로 중단됐다. 전체 suite가 통과했다고 주장하지 않는다.
- root가 실제 React 화면·합성 API 상호작용·키보드·레이블·체크박스 흰색·작은 화면·상세 고지·코드 입력 픽셀 불변을 독립 검사했다. 그 결과는 해당 브라우저 JSON/PNG에 남아 있으며 실제 서버·DB·기기 검증과 구분한다.
- 첫 녹음 POST 후 두 번째 확인 전 이탈하면 서버에는 녹음 동의 및 계정 EEG 값이 존재할 수 있다. 선택 저장 완료로 표시하지 않으며 재입장 시 서버 상태를 복원한다.
- 여러 기존 endpoint 저장은 원자적 트랜잭션이 아니다. 이미 서버에 도착한 요청을 언마운트로 되돌릴 수 없다. 진행 중 요청의 취소/롤백을 보장한다고 표현하지 않는다.
- 실제 LINK BAND, iOS/Android 권한, 네이티브 인계 실기기 동작, 운영 API/DB 저장은 이번 로컬 검사로 입증하지 않았다.
