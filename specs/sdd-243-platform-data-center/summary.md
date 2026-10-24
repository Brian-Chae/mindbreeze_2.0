# SDD-243 — 플랫폼·기관 데이터 센터 FE 구현 결과

- 실행일: 2026-10-24 / 워크트리 `mindbreeze_2.0-sdd243fe` / 브랜치 `sdd/243-fe`.
- 승인 범위: 사용자 요청에 따른 F01 → F02 → F03 구현·FE 검증·Task별 커밋·브랜치 push. PR·배포·서버·DB·.env·메일·삭제 실행 없음.
- 선행 동기화: `git fetch && git merge origin/sdd/243-be`, `06fde10a → 1f7371b7` fast-forward, 충돌 없음. B01~B04·계약·합성 fixture 유입이며 BE 파일의 FE 자체 수정은 없음.
- 증거 수준: **실제 React production build + Chrome + 합성 API fixture**. 실제 API/DB/244 저장·ZIP·운영 인증 인수 완료가 아니다.

## Task 결과

### F01 — 공통 탐색 (`b086cea2`)

- `/admin/data-center`와 `/org/data-center`, 역할별 메뉴·기관명·capabilities 탭.
- 보라/크림 토큰, 전역 집계 카드, 테이블·검색·상태·기관/유형 그룹·cursor·빈 상태.
- 클래스 → 회차 → 참여자, 회원/상담사 단위 탐색. 상담사는 조회 기간 필수, 회원 모드는 client 필터.
- 개요 inventory, 사용자, 클래스, 동의·연구 배치, 보관 실행·후보·탈퇴, 표준 baseline, 작업·감사 탭. 제한 DTO의 한국어 allowlist 투영만 사용.
- 기관/탭/대상/필터/페이지 변경 시 민감 상세·반출 선택 폐기, 요청 abort, 늦은 개인정보 응답 폐기.

### F02 — 측정 그래프 (`c1564df1`, 최종 메타 보완은 F03 커밋)

- EEG fp1/fp2, PPG red/ir, ACC xyz 원파형, 원 float feature 표, PSD, 당시 표시 6지표. HRV는 SDNN(ms).
- 10/30/60초 및 `[from,to)` 선택을 파형·feature·표시값·PSD·다운로드에 공유.
- 채널별 숫자 시간축, segment/gap 미연결, 단일 샘플 점, envelope 방법·원천/응답 수 표시. 미수집/null을 0으로 채우지 않음.
- 단건 상세 별칭·밴드·manifest/revision·동의·보관·신호 상태·포맷·시각·출처 표시.
- B04 indices API에는 범위 필터가 없어 FE가 `[from,to)`를 적용하고 다음 cursor를 유지한다. 과거값 재구성이나 종합점수·순위·판정 생성 없음.

### F03 — 다운로드·작업·감사

- 클래스/회차/선택 참여자/참여자 단건·측정 구간/회원/상담사 대화상자. 선택 회차·기간·50회차 묶음, 신호 5종과 bin 별도.
- 가명 기본, 사유 trim·길이, 기관 운영 목적/capabilities, preview 제외 범위 확인, POST 재인증 proof → 작업 생성. 체크박스로 인증을 대신하지 않음.
- 같은 생성 payload 재시도에 멱등키 유지, 새 preview·사유 변경 시 교체. 429 기존 작업 이동.
- 작업 상태·실제/예상 part·만료·재조회·cursor, part 재인증·링크 발급. 취소/part 교체/기관 변경 시 늦은 응답 폐기.
- 감사 actor_id/role/기관/목적/사유/결과/정책·cursor. 링크 발급과 실제 파일 수신 완료를 구별.
- 원본 파일 구조는 계약의 README_ko·dictionary·manifest 및 class/session/participant 경로 안내.
- 메뉴 회귀: 센터 항목의 report 키 재사용을 제거해 리포트 배지 복제를 차단. 기존 메뉴 골든에 승인된 새 센터 항목만 추가하며 기존 단언·키별 배지 검증 유지.

## 검증

- 신규 SDD-243 focused: **34/34 통과** (탐색 8, 측정 12, 반출 14). 모듈 부재·동작 RED 후 GREEN, DOM 전환·늦은 응답/취소·50/51·기관·범위·재인증·cursor 등 검증.
- 메뉴 관련: **29/29 통과**. 신규 메뉴 계약 골든과 센터 배지 비복제 회귀 포함.
- `npx tsc --noEmit -p tsconfig.app.json`: 통과.
- `npm run build`: 통과. 기존 대형 청크 및 정적/동적 import 혼용 경고는 남음.
- 기준선 전체: 257파일, **2,835 통과 / 기존 실패 17 / 총 2,852**.
- 최종 전체: **259파일(251 통과/8 실패), 2,867 통과 / 기존 실패 17 / 총 2,884**, 168.79초. 실패 파일·건수는 기준선과 정확히 일치. 메뉴 추가로 변경된 골든 5건은 새 항목을 추가하고 배지 키 중복을 수정하여 해소했다.
- Chrome `channel:'chrome'`: 실제 빌드 정적 파일을 Playwright route로 HTTPS 합성 origin에 제공. 서버 프로세스·외부 API 호출 없이 모든 요청 차단/fixture 응답. 플랫폼/기관 각각 1440×1000,390×844.
- Chrome 결과: **68장 / 108검사 통과 / 브라우저 예외0 / 페이지 가로 넘침0**. 390px 모달 생성 CTA가 하단 메뉴에 가려진 문제는 body portal로 수정하고 실제 클릭 재확인.
- 캡처 및 자동 검사: `captures-impl/`, `capture-results.json` (각 화면 가로 넘침·역할 탭·빈 검색·공유 범위·재인증 전 생성 차단 기록). 스크립트 `frontend/e2e/sdd243-capture.mjs`.
- node_modules는 요청한 메인 frontend 경로의 심볼릭 링크, 추적/커밋 제외. 전체 테스트가 덮어쓴 SDD-234 캡처는 `git checkout --`로 원복.

기존 실패 17건(이번 FE 수정과 분리):

- `org-management-browser.test.cjs` 2: 기관 모달/목록 필터·포커스.
- `org-counselor-management-browser.test.cjs` 1: 상담사 보호·확인 사유·역할/소속.
- `sdd234-a-mobile-home.test.tsx` 4: member/host 768·1440 계산 스타일 골든.
- `report-modal-pdf.test.cjs` 2, `report-server-pdf.test.cjs` 2: 모달/PDF/서버 다운로드.
- `agent-counselor-page.test.tsx` 2: 상담사 CTA/메시지 표시.
- `chat-message-deeplink.test.ts` 2: missing/failure 복귀.
- `sdd220-native-release.test.ts` 2: native 버전·Privacy Resources·서명.

## Mock 및 남은 인수

- B01~B04 조회는 계약 경로와 typed client를 연결하고 fixture로 검증했으며 실제 API 권한·데이터 응답은 미검증.
- B05~B07 미연결: `POST /exports/preview`, `POST /exports`, `GET /exports[/{id}]`, `POST /export-reauth`, `POST /exports/{id}/download-url`, `GET /download-audits`. 기본 제품 client는 정본 경로를 사용하고 테스트/캡처에서만 mock transport를 주입/가로챈다. 인증정보·proof·URL은 저장소에 보관하지 않는다.
- 실제 ZIP 생성/독립 복원·1GB part·서명 URL·실제 재인증·영속 감사·서버 정책/TOCTOU·PG·스토리지·244 T06/T12·실기기는 후속 BE/QA 인수 범위다. 성공으로 표시하지 않았다.
- preview/status fixture의 고정 만료 시각은 캡처 합성 응답에서 현재시각 기준 미래로 조정한다. 실환경 기한을 연장한 작업이 아니다.
- verify.md의 V01~V12 체크박스는 복합 실API/BE 조건을 포함하므로 통째로 완료 처리하지 않고 이 FE mock 실행 증거와 구별한다.
