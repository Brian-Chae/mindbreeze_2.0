# SDD-237 — FE 구현 결과 (Stage ⑥)

- 대상: `sdd/237-fe-class-report`, 기준 `e4e22b00`. 대표님 승인 후 F0→F8 진행.
- FE 구현 결과이며 BE·PG·실제 API·장치·통합 검증(I1~I3)은 포함하지 않는다. SDD 전체 완료·배포 완료를 뜻하지 않는다.
- backend, 서버/DB, .env, 메일, develop, PR, 배포 변경 없음.

## Task 완료

- F0: API §4 타입, summary/report 9상태 JSON·편집본·PATCH fixture, mock 클라이언트. `fe16817e`로 가장 먼저 커밋·push. 계약 테스트 12개 통과. **계약 변경 없음**.
- F1: RoleGuard 요약 라우트, S0·S1·S2·S6, 서버 인원/승인 현황, 다음 회차, 9상태. 유예 0분 즉시 적용, 무데이터 수동 검토 안내.
- F2: 서버 claim 성공 때만 진행 기록 안내, 비워두기·전체 끄기, 실패 시 닫힌 카드와 재시도, 설정 낙관적 변경·실패 복원.
- F3: 리포트 S1~S5, 몸→마음 6장, Recharts 마음 0~100·몸 별도 축, 결측 비연결, 2명 미만 평균 숨김, 참여자 검색·상태 필터·개인 상세.
- F4: 서사 수정·저장·취소·확인 후 되돌리기, AI/상담사 출처·수정자·시각, 빈 입력/길이 제한, 409 입력 보존·최신본, 403 읽기 전환. 편집 시작 버전 고정, 최신 서버 응답·stale 반영.
- F5: 명상 호스트 종료 응답 completed 확인 후 요약 replace, leaveTo 유지, 완료 재접속 요약. 상담은 기존 기록 보기. 실제 클래스 상세·기록에 완료 명상 링크.
- F6: 기존 client 필터 유지·관리 화면 추가 방어, counselor && class_report 상세 분기.
- F7: 외부 AI 집계 전송 안내, 기존 AI 미제공 문구 정합, 방침 버전·시행일 유지. 음성 자동 전사는 현재 미제공임을 별도로 유지.
- F8: vitest·tsc·ESLint·envDir:false 빌드, Chrome 390/1440 상태별 화면·편집 검증과 비교 페이지.

## 변경 경로

`frontend/src/lib/class-report/**`, `lib/api/class-summary.ts`, `components/class-report/**`, `components/session-summary/**`, `pages/sessions/{session-summary-page,class-report-page}.tsx`, `App.tsx`.
기존 통합: `ClassPlayerPage`, `EndingScreen`, `host-ending-model`, `ReportDetailView`, `class-report-manage`, `use-session-report-rows`, `SessionDetailPage`, `SessionRecordPage`, `SettingsPage`, 설정 토글, `privacy-policy`.
검증: `frontend/tests/class-report-*.test.*`, `session-summary-*.test.tsx`, `frontend/e2e/{capture-class-report.mjs,vite-class-report.config.ts}`.

## 검증 결과

- 관련 기존·신규 46파일 **838개 통과**. 후속 추가 회귀 테스트까지 report/summary 6파일 **47개 통과**, 리포트 워커 최종 **29개 통과**.
- `npx tsc --noEmit -p tsconfig.app.json` 통과.
- 변경 TS/TSX/MJS 전체 ESLint 통과.
- `npm run build -- --config e2e/vite-class-report.config.ts` 통과. `envDir:false`로 .env 로드 없음. 기존 청크 크기·동적 import 경고 유지.
- Chrome: 지정 executablePath, 외부 요청 차단, 인증·데이터 모두 합성 fixture. 요약/리포트 9상태×390/1440, 수정 중·근거 펼침 총 **40장**. 자동 검사: 가로 넘침·13px 미만 글자·44px 미만 조작·pageerror 모두 0. 문장 저장→상담사 출처 전환→AI 초안 되돌리기 실제 클릭 통과.
- 캡처·검사: [나란히 비교](screens/fe/index.html), [자동 검사 JSON](screens/fe/audit.json). 시안 왼쪽/실제 앱 오른쪽.
- 전체 vitest 최종 결과는 아래 최종 실행 기록에 기재한다.

## 독립 리뷰와 수정

구현자와 검증자를 분리해 diff·테스트로 재검증했다. 실제 상세 라우트 링크 누락, 이전 회차 늦은 응답 덮어쓰기, AI narrative_pending 완료 갱신, 편집 중 최신 props에 의한 409 우회 가능성을 발견해 수정했다. 최신 서버 문장·수정자·stale 갱신과 입력 보존도 검증했다.

## 확정 시안과 의도한 차이·판단

- 시안의 합성 4명/30분 대신 **계약 fixture 6명 참석·4명 측정·5명 대상/45분** 사용. 숫자·이름·방향을 UI에서 계산하거나 AI로 생성하지 않는다.
- 시안의 유예 선택·보류·시안 전용 편집기는 범위 밖이므로 제외. 유예 0분 즉시 적용만 표시하고 기존 기록 라우트로 연결한다.
- AI 문장 수정은 확정 시안 이후 결정 10으로 승인되어 실제 편집 UI를 추가했다.
- 기존 `NarrativeSections`의 DualBarChart는 비공개이며 점 단위와 10/11px 텍스트를 사용한다. 소유권 밖 파일을 바꾸지 않고 같은 두 막대 표현을 새 클래스 컴포넌트에 구현했다.
- 선택 기능인 구간별 ‘개인 평균 범위’ 음영은 계약 시계열에 min/max가 없어서 생략했다. 임의 수치를 만들지 않고 카드의 서버 min/max는 표시한다. 잘못된 판단일 경우 후속 API 계약 확장이 필요하다.
- 실제 서버의 다중 탭/기기 claim 원자성·수정 잠금·AI/자동 승인·개인 리포트 API는 통합 워커가 검증해야 한다. FE mock은 서버 대체 검증이 아니다.

## 커밋

- `fe16817e`: F0 계약·fixture, 즉시 push
- `aed08b42`: 회차 요약·진행 기록 안내
- `ff839727`: 종료 동선·승인 집계·설정·방침
- `2f4684b7`: 클래스 리포트·서사 편집
- `c4bbb69d`: 요약 요청 경합·오류 고지 보완

## 최종 실행 기록

- 최종 신규 기능 테스트: **8파일 68개 통과**.
- 최종 전체 vitest: **231파일 통과 / 7파일 실패**, **2688개 통과 / 13개 실패**(총2701). 신규/관련 기능 실패 0. 최종 추가 회귀 2개는 별도 29개 리포트 테스트에서 통과.
- 기준 e4e22b00 임시 추출본에서 agent-counselor 2건·chat-message-deeplink 2건 동일 재현. org-management 2건·org-counselor 1건·report-modal-pdf 2건·report-server-pdf 2건도 동일 재현(로컬5175 미실행/브라우저 harness 실패). 총11건 기준 재현.
- 나머지 sdd234-a-mobile-home 2건은 날짜 의존 고정 시안 비교: 768/1440에서 `D-2` 기대가 오늘 `D-1`로 바뀌며 글자 너비만 다름. 이번 변경은 해당 회원 홈 코드·CSS를 수정하지 않았다. 기준 추출본의 해당 측정 beforeAll은 120초 시간초과로 건너뛰어 동등 재현은 미확인이다. 테스트/기준 스냅샷을 변경하지 않았다.
- 전체 테스트가 덮어쓴 SDD234 캡처 6파일은 실행 종료 후 작업 전 HEAD 내용으로 복원했다. backend diff 0.
- 최신 코드 Chrome 재캡처 **40장**, audit 위반 0, 저장·되돌리기 성공. 시안 비교 index와 로그를 screens/fe에 보관했다.
- 병합·PR·배포 없음. 실제 BE 통합(I1~I3) 및 실제 기기·DB 검증은 남아 있다.
