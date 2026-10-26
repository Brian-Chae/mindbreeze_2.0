# 입장 전 안내 화면 요약형(A안) 적용

## 승인·범위

- Brian 2026-10-22 승인: f5fdd1b7 A안 적용, 같은 워크트리·브랜치, develop 리베이스 후 구현·검증·푸시·PR.
- 고지 원문은 상세 시트로 이동할 뿐 삭제하지 않는다. 리포트 기본값·연구 선택 동의·제출 데이터·API는 유지한다.
- 제품 코드 범위: NoticeStepView와 전용 스타일, 기존 FlowSheet/PlayerSheet의 하단 시트 재사용에 필요한 최소 옵션.
- 블러 금지, 본문 15px 이상·보조 13px 이상·터치 44px 이상.

## 원인·구현 계획 (구현 전)

현재 고지 화면은 기록·열람 권한·연구 활용 원문을 모두 카드 본문에 넣어 작은 글자로 긴 내용을 표시한다.
1. 기존 초기값·제출 계약과 고지 조건 분기를 확인한다.
2. 상세 시트 열기/원문/선택 독립성 회귀 테스트를 먼저 작성하고 실패를 확인한다.
3. A안의 요약 타일·리포트 선택·연구 핵심을 구현하고 세 상세 시트에 원문을 배치한다.
4. 실제 앱 라우트의 API를 mock해 Chrome 390×844·1440×900에서 기본 화면과 세 시트를 검증한다.
5. 관련 vitest, 타입 검사, 변경 파일 eslint, 빌드 및 독립 리뷰 후 증거·PR을 남긴다.

## 검증 체크리스트 (구현 전)

- [x] 제품 reportChoice 초기값 유지; researchConsent 기본 false.
- [x] 리포트 포함/제외/null 및 연구 동의 on/off/저장 실패가 기존 callback/API와 동일.
- [x] AI on/off·온라인/대면·밴드 none/opt·명상/상담·기간 숫자/null 분기 원문 보존.
- [x] 세 시트 원문, 닫기/Escape/포커스 복귀, 배경 조작 방지.
- [x] 기본 모바일에서 내용 스크롤 없이 CTA까지 표시, 본문·터치 크기 실측.
- [x] mock 외 외부 API/웹소켓 차단; 서버/DB 접근 없음.
- [x] 의존성 임시 심링크 커밋 제외 및 작업 종료 시 제거. 기존 설치 디렉터리는 별도 보존 후 복원.

## 최종 구현 결과

- 최신 origin/develop b7762b40 위로 리베이스 완료. 제품 구현 커밋 65e4a211.
- 변경: NoticeStepView.tsx, notice-step.css, MemberFlowFrame.tsx, flow-primitives.tsx, PlayerSheet.tsx, PlayerShell.tsx 및 고지/동의 회귀 테스트 3개.
- 화면: 기록·열람·보관 타일, “뇌파: 밴드 착용 시에만 / 영상: 카메라 켤 때만”, 관리자 명상 리포트 제한, 리포트 선택, 연구 선택 동의와 데이터 종류·무기한·철회·미동의 참여 안내.
- 팝업: 기록 원문·역할별 권한 전체·보관 원문 / 리포트 제외 참여 가능·발송 후 되돌릴 수 없음·미선택 처리·변경 가능 시점 / 연구 원문 5개 단락.
- 명상 외에는 원문에 없는 열람 대상을 추정하지 않고 기록·보관 2타일만 표시한다.
- 데이터 제출·API·백엔드 변경 없음. 기본값은 시안 fixture의 excluded가 아니라 제품의 null(미선택)을 유지했다.
- emptyPrepDraft/useEntryPrep/EntryPage 확인: reportChoice=null, researchConsent=false. 계속하기에서 report_included=false를 제출; 포함을 직접 선택하면 true. 연구는 체크 때 기존 API와 r5-1 notice_version으로 저장.
- FlowSheet/PlayerSheet 재사용, optional sheetMode=bottom은 이 화면에서만 지정. 다른 화면 기본 반응형 동작 유지.

## 테스트 및 독립 검증

| 검증 | 결과 | 증거 |
|---|---|---|
| 관련 vitest 10파일 | 248/248 통과 | entry-notice-summary/vitest-related.log |
| 전체 npm test -- --run | 212파일 통과 / 6파일 실패, 2536통과 / 11실패 | entry-notice-summary/vitest-full.log |
| 실패 6파일 origin/develop 대조 | 동일 11실패 재현(12통과) | entry-notice-summary/vitest-baseline-failures.log |
| npx tsc --noEmit -p tsconfig.app.json | 통과 | entry-notice-summary/tsc.log |
| 변경 TSX/테스트 eslint | 통과 | entry-notice-summary/eslint.log |
| npm run build | 통과, 기존 청크 크기·동적 import 경고 | entry-notice-summary/build.log |
| 별도 코드 리뷰 | Important/Critical 없음, 원문/기본값/API/기존 시트 계약 보존 | 65e4a211 기준 독립 리뷰 |

전체 테스트의 기존 실패 목록(이번 작업에서 수정하지 않음):
- agent-counselor-page.test.tsx: 상담사 브리핑 CTA 및 메시지 전송 UI 2건.
- chat-message-deeplink.test.ts: missing/failure 복귀 기대값 2건.
- org-management-browser.test.cjs: 기관 모달·목록 상태/포커스 2건.
- org-counselor-management-browser.test.cjs: 상담사 보호·역할/소속 조작 1건.
- report-modal-pdf.test.cjs: 수신 주소 유/무 PDF 2건.
- report-server-pdf.test.cjs: detail/email 다운로드 2건.
브라우저 파일 7건은 로컬 5175 서버 연결 실패를 포함한다. 모두 b7762b40 원본에서 동일 재현했으며 이번 변경 관련 실패는 없다. 전체 실행 이후 최종 리베이스·CSS 조정에 대해 관련 248테스트/빌드/타입/브라우저를 재확인했다.

## 실제 앱 라우트 Chrome 검증

- 실행: frontend에서 npm run build 후 저장소 루트에서 node fix-notes/entry-notice-summary/capture-app.mjs.
- 실제 App 번들과 /class/:sessionId/enter 라우트 → 입장하기 → 고지 화면. 컴포넌트 단독 하니스가 아니다.
- 합성 입장 자격/API 응답을 사용하며 외부 HTTP·웹소켓은 차단. 실제 서버·DB·메일·고객정보 접근 없음.
- 지정 Chrome executablePath 사용. AI 플래그 기본 비공개인 실제 빌드이므로 기록 시트는 “녹음” 안내; AI 켜짐 분기는 vitest로 검증.
- 개발서버 방식은 의존성 최적화와 CSS import 대기 문제가 있어 최종 검증을 실제 프로덕션 빌드의 로컬 정적 서빙으로 전환했다. 캡처 시 시트 애니메이션 종료를 기다린 후 실측한다.

| 크기 | 본문 clientHeight / scrollHeight | CTA 하단 | 작은 글자 / 터치 미달 |
|---|---|---:|---|
| 390×844 | 648 / 648 | 760px | 13px 미만 0 / 44px 미만 0 |
| 1440×900 | 704 / 704 | 816px | 13px 미만 0 / 44px 미만 0 |

- 핵심 본문 모두15px 이상, 상세16px 이상. blur 적용0. 원문 포함·모달 bottom·Escape·포커스 복귀 검증.
- 시트 열고 닫기만으로 제출0건. 연구 on/off의 consented true/false 및 기본 report_included false, 선택 후 true 전송까지 payload 대조.
- PNG: entry-notice-summary/screenshots/default-{390,1440}.png 및 {record,report,research}-{390,1440}.png (총8장).
- 상세 수치·합성 제출 데이터: entry-notice-summary/browser-results.json. 실행 로그: browser.log.
- 실제 기기·웹뷰·폰트 확대·실서비스 저장 동작은 별도 검증 범위다. 긴 제목/오류 등 더 큰 콘텐츠는 스크롤을 허용한다.

## 의존성·작업 범위

- 기존 node_modules 실제 디렉터리를 임시 위치에 보존한 뒤 원본 저장소 심링크로 검증했다. 임시 심링크는 검증 종료 후 제거했고 기존 디렉터리를 복원했다. 기준 브랜치 검증용 임시 복사본의 의존성 링크도 제거했다. 커밋에는 포함하지 않는다.
- fix-notes와 기존 designs 산출물 외 제품 변경은 위 프런트엔드 범위만. 머지·배포 없음.
