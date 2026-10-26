# 입장 고지 A안 구현 기록

## 변경

- `NoticeStepView.tsx`: 기록·열람·보관 요약 타일, 리포트 선택, 연구 핵심 안내와 독립 체크를 표시한다. 고지 원문과 AI/장소/밴드/클래스 유형/보관 기간 분기는 세 상세 시트에 보존한다.
- `notice-step.css`: 이 화면에 한정한 15/24 본문·13/20 보조·44px 조작 영역, 다크 불투명 카드 및 16/26 상세 본문. 블러를 추가하지 않았다. 명상 외에는 열람 권한을 추정하지 않고 기록·보관 2타일을 표시한다.
- `MemberFlowFrame`, `FlowSheet`, `PlayerSheet`, `PlayerShell`: 선택적 `sheetMode` 전달만 추가했다. 입장 고지는 하단으로 고정하고 다른 화면은 기존 반응형 기본값을 유지한다. 기존 Escape·포커스 복귀·inert 처리 재사용.
- `class-flow-member-prep`, `sdd216-notice`, `sdd220-auth-consents`: 기존 원문 assertions를 삭제하지 않고 상세를 연 후 검사하도록 조정. 세 시트, 포커스 복귀, AI on/off, 조건 분기, 연구 독립성과 실패 안내를 검증한다.

## 제품 계약

- 실제 `emptyPrepDraft()` 기본값은 `reportChoice: null`, `researchConsent: false`. 변경하지 않았다.
- props·콜백·`useEntryPrep`·API·제출 데이터·백엔드 변경 없음.
- 상세 확인/닫기는 시트만 닫으며 동의·리포트 선택을 대신하지 않는다. 선택하지 않거나 저장에 실패해도 계속하기는 활성이다.
- 시안의 excluded fixture를 제품 기본값으로 복사하지 않았다.

## RED / GREEN

1. 기존 구현에서 상세 진입 버튼 부재 등을 확인: `class-flow-member-prep` + `sdd216-notice`, 9 실패 / 11 통과 (`/tmp/entry-notice-red.log`).
2. 구현 후 AI DOM 테스트의 `matchMedia` 환경 설정 부족을 보완했다.
3. 명상 외 열람 타일을 표시하지 않는 회귀 테스트: 1 실패 / 16 통과 확인 후 조건부 2타일로 수정했다.
4. 고지·동의·개인정보 회귀 4파일: **48 통과** (`/tmp/entry-notice-green.log`).
5. 공용 Player/회원/호스트/flow 시트 회귀 4파일: **169 통과** (`/tmp/entry-notice-shared.log`). 기존 시트 테스트의 React act 경고가 출력됨.
6. 최종 관련 8파일 합산 재실행: **217 통과** (`/tmp/entry-notice-final.log`).
7. 담당 TSX 소스 5파일 ESLint 통과 (`/tmp/entry-notice-lint.log`).

## 실제 화면 확인과 검증 경계

- 감독이 실제 앱 라우트를 mock한 Chrome 검증을 담당한다. 첫 390×844 캡처에서 연구 체크 하단이 CTA에 가려져, 전용 CSS에서 비조작 안내 최소높이를 44→20px, 해당 화면 상하단 여백을 8px로 조정했다.
- 감독의 모바일 실측에서 기본 본문 높이/스크롤 높이 648px 동일, 13px 미만 글자·44px 미만 터치 0건. 상세 시트는 그리드와 스크림에 가려지는 문제가 발견되어 전용 CSS로 절대 위치·하단0·z-index6을 명시했다.
- 전체 타입 검사·빌드·전체 테스트·최종 모바일/데스크톱 및 시트 캡처 결과는 감독 검증 기록을 따른다.
- 실제 서버 저장·DB·메일·배포는 이 구현 검증 범위 밖이다.
