# SDD-322 — Verify (구현 전 QA 체크리스트, 사후 수정 금지)

기준선(변경 전) 산출물: `~/.hermes/cache/scratch/sdd322/`(baseline-vitest.txt, dist-base/ = `VITE_UI_V2=true` 강제 prod 빌드).

## A. 플래그 off 불변
| ID | 검증 | 방법 | 통과 기준 |
|---|---|---|---|
| A1 | 전체 vitest | `cd frontend && npx vitest run` | 기준선과 실패 파일 목록·건수 동일, 신규 실패 0 |
| A2 | 운영 빌드 불변 | `VITE_UI_V2=true npx vite build --mode prod` 후 dist-base 와 파일 단위 비교 | 파일 집합·내용 동일(차이가 있으면 파일 목록과 이유를 summary 에 열거, CSS 는 반드시 동일) |
| A3 | 검사 스크립트 | `node scripts/check-ui-v2-off.mjs <운영 dist>` | 통과. 알림 D안 청크(`ui-v2-(notifications\|org-notifications\|notification-center)`, `use-ui-v2-notifications`, `ui-v2-notification-parts`)·`u2-notif-` CSS 검사 추가분 포함 |
| A4 | 위반 샘플 | 위 식별자를 주입한 임시 dist 에 실행 | 모두 exit 1 (vitest 로 고정) |
| A5 | 공유 파일 무수정 | `git diff --stat origin/develop..HEAD` | `AppShell`·`SidebarNav`·`MobileDrawer`·`ClientShell`·`NotificationCard`·`notification-format.ts`·`api/notifications.ts`·`notificationStore`·`index.css`·tailwind·`ui-v2.css`·`ui-v2-brand.css`·`ui-v2-org.css`·구 알림 페이지 2종 diff 0 |
| A6 | 수정 허용 목록 | 같은 diff | 기존 파일 수정은 `ClientAppPage.tsx`·`App.tsx`·`ui-v2-coach.css`·`check-ui-v2-off.mjs` 뿐. 기존 테스트 수정 0 |
| A7 | 번들 검사 | `node scripts/check-release-bundle.mjs <운영 dist>` | 통과 |
| A8 | 백엔드·워크플로·네이티브 | diff | `backend/`·`packages/`·`.github/`·`measurement_core.h` 변경 0 |

## B. 플래그 on 화면 (합성 API, 390/768/1440px)
대상: 내담자 알림(목록·빈·오류·읽지 않음/읽음 혼합·본문 펼침), 기관 알림(목록·설정 패널 열림·빈), 코치 알림(스킨 확인, 목록·설정 패널·빈).
| ID | 항목 | 통과 기준 |
|---|---|---|
| B1 | 가로 넘침 | 문서 수준 `scrollWidth <= clientWidth` 전 조합 0건 |
| B2 | 하단 가림 | 모바일에서 마지막 행 하단 ≤ 하단 내비 상단 |
| B3 | 터치 영역 | a·button·[role=switch] 폭·높이 ≥ 44px (예외는 summary 에 열거) |
| B4 | 대비 | 본문/보조/액센트/칩/읽지 않음 점 × 배경 ≥ 4.5:1 (계산 출력 첨부) |
| B5 | 금지 표현 | 신규 소스 문구 + 렌더 화면(서버 문구 제외) 에서 `점수\|종합점수\|좋음\|나쁨\|완료율\|보증\|100\s*%` 0건 |
| B6 | 긴 제목·본문 | 합성 긴 제목에서 행이 잘리거나 넘치지 않음(줄바꿈/말줄임) |
| B7 | 모션 | `prefers-reduced-motion: reduce` 에서 전환·애니메이션 0 |
| B8 | 폰트 | 제목·본문이 Pretendard Variable 로 렌더(CDP). 측정 불가 시 못 했다고 기재 |
| B9 | 쉘 일관성 | 내담자: 하단 내비 `aria-current` 단일, 설정·채팅 탭과 같은 쉘. 기관: 사이드바/모바일 상단 바 동작 |

## C. 기능 보존 (vitest 단언)
| ID | 단언 |
|---|---|
| C1 | 내담자: `listNotifications(false,50,0)` 호출, 항목 렌더, 읽지 않은 항목 클릭 시 `markRead(id)` → 읽음 표시 → 스토어 `fetch` 호출, 딥링크 있으면 `navigate(path)` |
| C2 | 내담자: 딥링크 없으면 본문 펼침(두 번 누르면 접힘), `markRead` 실패 시 오류 메시지 `role=alert` |
| C3 | 내담자: 전체 읽음 → `markAllRead` → 모든 항목 읽음 표시, 실패 시 메시지, 로딩 중 버튼 비활성 |
| C4 | 내담자: 로딩 `role=status`, 빈 상태 문구 `아직 알림이 없습니다.`, 오류 + `다시 시도` 로 재조회 |
| C5 | 기관: 목록·읽음·딥링크(`resolveNotificationTarget(extra, role)`)·전체 읽음(읽지 않은 것 있을 때만 버튼) · 요약줄 문구(`읽지 않은 알림 N개`/`모든 알림을 읽었습니다`) 구버전과 동일 |
| C6 | 기관: 설정 토글 → `getPreferences` 로 패널 로드, 토글 시 `updatePreferences` 낙관적 갱신, 실패 시 되돌림 + 오류, `role=switch`·`aria-checked`·`aria-label` 구버전과 동일 |
| C7 | 진입점: org_admin 이면 기관 D안 화면, counselor 면 구 `NotificationCenterPage` 렌더(분기 정확성) |
| C8 | 로직 불변: 구 알림 페이지·`NotificationCard`·API·스토어 파일 diff 0 |

## D. 분기 정확성
| ID | 검증 | 통과 기준 |
|---|---|---|
| D1 | `ClientAppPage`/`App.tsx` 분기 | `import.meta.env.VITE_UI_V2 === 'true'` 삼항, off 쪽은 기존 import 와 동일 경로 |
| D2 | 라우트·가드 | `/notifications` `RoleGuard`·`/app/notifications` 게이트 예외 diff 0 |
| D3 | CSS 스코프 | `ui-v2-notifications.css` 모든 선택자 `.ui-v2` 시작, `ui-v2-coach.css` 신규 규칙 모두 `html.u2-coach` 시작 |

## E. 정적 검사
`npx tsc -b` 오류 0 / 변경·신규 파일 eslint 오류 0 / `any` 0 / 파일명 kebab-case.

## F. 한계
- 실기기 노치·키보드·스크린리더 검증 불가(headless Chromium 캡처). 서버·DB 접근 없음(합성 API).
- 푸시·PR·배포·앱 빌드·메일 없음. 플랫폼 관리자 알림은 범위 밖.
- SDD-234 캡처 덮어쓰기 발생 시 커밋 전 `git checkout origin/develop -- <경로>`.
