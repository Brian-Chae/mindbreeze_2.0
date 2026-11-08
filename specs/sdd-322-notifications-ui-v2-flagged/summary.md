# SDD-322 — Summary

- 브랜치: `sdd/322-notifications-ui-v2-flagged` (로컬 커밋만. 푸시·PR·배포·앱 빌드·메일·DB/서버 접근 없음)
- 커밋: `d12824a2`(spec·plan·verify, 구현 전) → 구현·시험·캡처·summary 커밋(아래 git log 참조)

## 1. 결과
| 대상 | 라우트 | 처리 | 파일 |
|---|---|---|---|
| 내담자 알림 | `/app/notifications` | D안 신규 화면(`UiV2ClientShell`) | `pages/client/ui-v2/ui-v2-notifications-page.tsx` |
| 기관관리자 알림 | `/notifications` (org_admin) | D안 신규 화면(`UiV2OrgShell`) + 설정 패널 | `pages/notifications/ui-v2/ui-v2-org-notifications-page.tsx` |
| 코치 알림 | `/notifications` (counselor) | 기존 마크업 유지, `html.u2-coach` 스킨 보강(카드·설정 패널·빈 상태·스위치) | `styles/ui-v2-coach.css` (규칙 추가) |
| 공통 | 훅·소품·CSS·진입점 | 목록/읽음/전체읽음/딥링크 훅, 알림 행·오류·빈 상태, `.ui-v2` 스코프 CSS | `use-ui-v2-notifications.ts`, `ui-v2-notification-parts.tsx`, `ui-v2-notification-center-page.tsx`, `styles/ui-v2-notifications.css` |

플랫폼 관리자 알림은 범위 밖(구버전 유지, 진입점이 기존 페이지로 위임). 수정한 기존 파일: `App.tsx`(lazy 선언 1개), `ClientAppPage.tsx`(lazy 1개 + 조기 반환 1블록), `ui-v2-coach.css`(규칙 추가), `scripts/check-ui-v2-off.mjs`(알림 검사 2줄). 기존 알림 페이지·`NotificationCard`·API·스토어·공유 쉘·공용 CSS diff 0.

## 2. 플래그 off 불변 (운영 빌드 `--mode prod`, `VITE_UI_V2=true` 강제)
| 검증 | 결과 |
|---|---|
| 변경 전 vs 변경 후 빌드 (해시 정규화 비교) | 347개 파일, 파일 집합 차 0, **CSS 동일**, 내용 차이는 `assets/ClientAppPage-*.js` 1개(분기 stub 선언부 — 318 과 같은 패턴) |
| `check-ui-v2-off.mjs` (알림 D안 청크·`use-ui-v2-notifications`·`u2-notif-` CSS 검사 추가) | 통과, 255개 파일, `.ui-v2` CSS 포함 파일 0 |
| `check-release-bundle.mjs` | 통과 |
| 위반 샘플 5종(청크명 4 + CSS 1) 주입 | 모두 실패 — vitest 로 고정 |
| 공유·구버전 파일 diff | 0 (vitest 로 고정), `backend/`·`packages/`·`.github/` 0 |

## 3. 시험
| 항목 | 결과 |
|---|---|
| 전체 vitest | 기준선 14파일/**24건 실패**·4,361 통과 → 변경 후 14파일/**24건 실패**·4,373 통과(+12 신규). 실패 파일 목록 동일, 신규 실패 0 |
| 신규 `sdd322-ui-v2-notifications.test.tsx` | 12건 (내담자 C1~C4, 기관 C5~C6, 진입점 C7, 분기·무수정·CSS 스코프·금지 표현, 검사 스크립트) |
| `tsc -b` / eslint(변경·신규) | 오류 0 / 오류 0 |

## 4. 플래그 on 측정 (합성 API, 10화면·상태 × 390/768/1440 = 30조건 + reduced-motion)
빌드: `VITE_UI_V2=true VITE_API_BASE_URL=https://sdd322.local/api/v1 npx vite build --mode development` (기본 production 모드는 플래그가 꺼지므로 development 사용).
| 항목 | 결과 |
|---|---|
| 문서 가로 넘침 | 0/30 |
| 알림 행 내부 넘침(긴 제목·긴 본문) | 0 |
| 하단 가림(모바일 마지막 콘텐츠 ↔ 내비) | 0 (여백 46px, 빈/오류 상태 342~447px) |
| 금지 표현(화면 크롬 문구, 서버 알림 문구 제외) | 0 |
| 터치 44px 미만 | D안 화면 0. **예외**: 코치 스킨 화면의 설정 스위치 6개는 버튼 40×24 이나 기존 마크업의 `-m-2.5 p-2.5` 래퍼가 터치 영역을 약 60×44 로 확보(마크업 불변 원칙) |
| 최소 대비 | 5.42:1(보조 글자/캔버스). 1차 측정에서 스위치 꺼짐색 `#8A8392`(3.66:1) 발견 → `#6B6472`(5.69:1)로 수정 후 재측정 |
| `prefers-reduced-motion: reduce` | 애니메이션·전환 요소 0 (기관 화면 설정 패널 포함. 내담자 쪽 측정은 아래 "못 한 것" 참조) |
| 폰트(CDP) | 내담자·기관의 h1·알림 제목·본문 모두 Pretendard Variable (웹폰트) |
| 하단 내비 `aria-current` | 내담자 화면은 알림이 내비 탭이 아니라 0개(홈 탭도 강조 안 함 — 설정·채팅 등 상세 화면과 동일 규칙) |
| 코치 스킨 | `html.u2-coach` 적용 확인, 카드/설정 패널/빈 상태 캡처 육안 확인 |
| JS 오류(pageerror) | 0 |

캡처: `specs/sdd-322-notifications-ui-v2-flagged/captures/` (client·client-expand·client-empty·client-error·org·org-prefs·org-empty·coach·coach-prefs·coach-empty × 390/768/1440 = 30장 + `measure.json`).

## 5. 기능 보존
| 항목 | 내담자 | 기관 | 코치(스킨) |
|---|---|---|---|
| 목록 50건 조회 | ✔ | ✔ | 불변 |
| 읽음 처리 + 전역 뱃지 재조회 | ✔ | ✔ | 불변 |
| 전체 읽음(+뱃지 갱신, 실패 메시지) | ✔ | ✔ (읽지 않은 것 있을 때만) | 불변 |
| 딥링크 이동 | role=client | user.role | 불변 |
| 딥링크 없으면 본문 펼침 | ✔ | — | — |
| 빈 / 오류+다시 시도 / 로딩 | ✔ | ✔ | 불변 |
| 설정 패널(이메일/인앱 토글, 낙관적 갱신·실패 되돌림) | — | ✔ | 불변 |
| 읽지 않은 수 요약줄 | ✔ | ✔ | 불변 |

## 6. 못 한 것 / 한계
- 캡처 스크립트 reduced-motion 측정에서 내담자 쪽은 목록이 안 떠(`reduced/client: 목록 없음`, 합성 API 의 `/client/counselors` 응답 누락) 기관 화면만 측정됨. 내담자 화면의 전환은 같은 `ui-v2-notifications.css` 의 `prefers-reduced-motion` 규칙과 공용 `ui-v2.css` 규칙이 적용되며 vitest 로 규칙 존재만 단언함.
- 실기기 노치·키보드·스크린리더 검증 불가(headless Chromium). 서버·DB 접근 없음.
- 기관 쉘 알림 진입 시 구버전이 보이는지: 기관관리자의 `/notifications` 는 `AppShell` 구버전이었고 이번에 D안으로 교체함(확인 완료). 내담자는 `ClientShell` 구버전이었고 교체함.
- 플랫폼 관리자 알림, 기관 공개 페이지는 범위 밖.
- 산출물: `~/.hermes/cache/scratch/sdd322/`(baseline-vitest.txt, after-vitest.txt, dist-base/after/v2).
