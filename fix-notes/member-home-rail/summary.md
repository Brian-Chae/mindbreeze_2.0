# 회원·상담사 홈 레일 수정 결과

기준: origin/develop 83bcda7b. API·데이터·기능 플래그·알림 필터/정렬/3개 제한은 유지했다.

## 변경
- ClientHomePage: 담당 상담사 이름/전문 분야/대화하기(/app/chat), 대화·알림 글자 확대. 알림 전체 행은 기존 알림 목록(/app/notifications)으로 이동한다.
- DashboardPage·notification-row: 같은 글자 규격, 대화 아바타40px, 전체 링크44px 이상. 상담사 알림 읽음·이동 로직 유지.
- home-card-parity.css: 레일 카드만 최소 높이 제거. 반경20px·패딩24px 유지.
- member-home-legacy-sections.test.tsx: 담당 상담사 CTA·알림 전체 행 버튼·이동 경로 회귀 검증.

## 전후 규격 (px)
| 항목 | 전 | 후 |
|---|---|---|
| 이름 | 13 (담당15) | 16 / 600 |
| 알림 제목 | 13 | 16 / 600 |
| 미리보기·본문 | 12~13 | 15 |
| 시간 | 12 | 13 |
| 섹션 제목 | 18 | 18 유지 |
| 대화 아바타 | 32 | 40 |
| 전체 링크 | 회원 높이 미보장 / 상담사44 | 양쪽 최소44×44 |
| 행 | 높이 미보장 | 최소56 |

## Chrome 실측 높이 (390/1440 동일, 합성 데이터)
| 카드 | 전 | 후 |
|---|---|---|
| 회원 담당 상담사 | 200 | 156.5 |
| 회원 최근 대화 1행 | 200 | 182.5 |
| 회원 새 알림 3행 | 350.5 | 380 |
| 상담사 최근 대화 1행 | 200 | 180.5 |
| 상담사 새 알림 3행 | 358.5 | 390 |

알림 3행은 글자를 키워 내용 높이가 늘어난다. 최소 높이는 모든 레일 카드0px.
빈 상태는 회원 대화/알림140.5px, 상담사136.5px이며 안내는 한 줄이다.

## 검증
- 관련 vitest: 10파일 / 106개 통과.
- 전체 vitest: 224파일 중218 통과·6 실패, 2570개 중2559 통과·11 실패.
- 기준 커밋 소스 임시 사본에서도 아래 동일11개 실패 재현. 범위 밖 수정 없음.
  - agent-counselor-page.test.tsx 2개: scrollIntoView 옵션, HTMLInputElement setter.
  - chat-message-deeplink.test.ts 2개: input disabled 기대.
  - org-management-browser.test.cjs 2개, org-counselor-management-browser.test.cjs 1개: locator 시간 초과/5175 연결 실패.
  - report-modal-pdf.test.cjs 2개, report-server-pdf.test.cjs 2개: 5175 연결 실패.
- npx tsc --noEmit -p tsconfig.app.json / 변경 TSX eslint / npm run build 통과. 빌드에는 동적·정적 import 혼용 및 500kB chunk 경고.
- 실제 Chrome 실행 파일로 /app·/dashboard, 390·1440 검증. 합성 localStorage 사용자, /api/** fixture, 외부 요청·socket 차단. 실제 서버/DB 검증은 수행하지 않음.
- 이름·알림16px/600, 본문15px, 아바타40px, 링크44px, 행56px 이상, 알림3개·가로 넘침·JS 오류·최소높이0 계산 스타일 검증.
- 별도 리뷰: 초기 CSS 우선순위 문제를 지적받아 section.home-rail-card로 해결. 검증자가 diff와 metrics 원본 재확인.

## 증거·재실행
- before/: 기준 커밋 실제 라우트 캡처·metrics.json
- after/: 수정 후 캡처·metrics.json
- after-empty/: 빈 상태 캡처·metrics.json
- *-panels.png: 레일 구간. *-card-N.png: 카드별. 기본 PNG: 홈 상단.
- 루트에서 node fix-notes/member-home-rail/parity.cjs, --empty 옵션으로 빈 상태 검증.
- node_modules는 원본 저장소 임시 심링크 사용, 커밋 제외·작업 종료 시 제거.
- 머지·배포·메일 발송 없음.
