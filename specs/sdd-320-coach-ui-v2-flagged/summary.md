# SDD-320 — Summary

## 결과
코치(counselor) 업무 화면에 D안을 **스코프 스킨**으로 적용했다. SDD-318 과 같은 플래그 `VITE_UI_V2` 뒤에서만 동작하고, 운영 빌드는 `vite.config.ts` define `'false'` 고정이라 켤 수 없다. 기존 페이지 마크업·핸들러는 수정하지 않았다(CSS 로만 덮음).

| 구성 | 파일 |
|---|---|
| 스킨 CSS (전 규칙 `html.u2-coach` 하위) | `frontend/src/styles/ui-v2-coach.css` |
| 스코프 판정·토글 (`counselor` ∧ 허용 경로 ∧ 제외 경로 아님) | `frontend/src/components/ui-v2/ui-v2-coach-scope.ts` |
| 분기점 (공유 파일 수정은 이 1곳) | `frontend/src/App.tsx` `RootLayout` effect 1개 |
| 운영 검사 확장 | `frontend/scripts/check-ui-v2-off.mjs` (u2-coach 식별자) |
| 시험·캡처 | `tests/sdd320-ui-v2-coach.test.ts`, `e2e/sdd320-capture.mjs` |

## 화면별 적용 상태
| 화면 | 라우트 | 상태 | 비고 |
|---|---|---|---|
| 대시보드 | `/dashboard` | ✅ 캡처 확인 | 히어로를 틴트 그라데이션+흰 카드로 교체(사진·다크 오버레이 제거), 타일·검토 배너·패널 D 카드, 사이드바·모바일 헤더·하단 내비 D 스킨 |
| 클래스 목록·상세 | `/classes*` | ✅ 캡처 확인(목록·상세) | 테이블 구조 유지, 카드 반경·색 D. **즉석 시작·다음 회차 카드의 사진 배경은 인라인 스타일이라 유지됨**(스킨 한계) |
| 회원 관리 | `/clients*` | ✅ 공통 스킨 | 테이블+검색 유지 |
| 리포트 검토 | `/reports*` | ✅ 캡처 확인 | 검토 배너·탭·표 D 색. 점수 표기 없음 |
| 상담·회차 | `/counseling*`, 회차 상세 | ⚠️ 공통 스킨만 | 합성 API 로 별도 캡처 안 함 |
| 데이터 현황 | `/upload-status` | ✅ 공통 스킨 | 캡처 통과 |
| 채팅 | `/chat*` | ✅ 캡처 확인 | 318 말풍선 규칙 재사용 |
| 설정 | `/settings`, `/profile/professional` | ✅ 공통 스킨 | 캡처 통과 |
| 알림 | `/notifications` | ✅ 공통 스킨 | |
| 제외 | `/sessions/*`(플레이어·라이브), `/classes/now`, `/dashboard/org`, `/org/*`, `/admin/*`, `/app/*` | 미적용 | 시험·캡처로 `u2-coach` 미부여 확인 |

## 플래그 off 불변 증거
- 운영 빌드(`--mode prod`, `VITE_UI_V2=true` 강제) `check-ui-v2-off.mjs` **통과**(255개 파일, 코치 식별자·Pretendard MB 0건), `check-release-bundle.mjs` **통과**.
- 변경 전(`83fb65c6`) vs 후 운영 산출물: 파일 354개 동일, **CSS 해시 집합 완전 동일**, JS 의 실질 차이는 `index` 청크의 `RootLayout` 에 빈 `useEffect(()=>{},[])` 1개 추가뿐(분기는 dead-code 제거됨).
- 공유 쉘·`index.css`·tailwind·`ui-v2.css`·`ui-v2-brand.css`·`DashboardPage.tsx` 무수정(시험으로 고정). 기존 테스트 파일 수정 0.

## 시험
| 항목 | 결과 |
|---|---|
| 신규 vitest 31건 | 통과 |
| 전체 vitest | 기준선 14파일/24건 실패(환경 의존) → 변경 후 동일 실패 목록, 신규 실패 0 (중간에 `sdd219` 상담 경로 문자열 검사가 걸려 정규식으로 수정 후 해소) |
| `tsc -b` | 0 |
| eslint(변경 파일) | 0 |
| 캡처·측정(합성 API, 390/768/1440 × 10화면 = 30조건) | 스코프 부여/제외 정상, 가로 넘침 0, 모바일 44px 미만 0, 금지 표현 0, 최소 대비 4.86:1, reduced-motion 애니메이션 0, 폰트 `Pretendard MB` |

캡처: `specs/sdd-320-coach-ui-v2-flagged/captures/*.png`, 측정: `measure.json`.

## 못 한 것 / 한계
1. 스킨 방식이라 **마크업 재구성이 필요한 시안 요소**(서사형 리포트 구성, 클래스 상세의 아크 커버·타임라인)는 미구현.
2. 클래스 화면의 사진 배경 카드(즉석 시작·다음 회차)는 인라인 `style`이라 CSS 로 못 바꿈 — 바꾸려면 `host-classes-page.tsx` 수정 필요.
3. 상담 목록·상세, 회원 상세, 리포트 상세, 클래스 만들기 마법사는 합성 API 로 개별 캡처하지 않음(공통 스킨 적용만).
4. 데스크톱 `≥768` 사이드바는 기존 마크업에 색만 입힘. 실기기·스크린리더·실서버 데이터 미검증. 푸시·PR·배포·앱 빌드 안 함.

## 대표 결정 필요
- 클래스 목록의 사진 배경 카드를 D안(틴트 카드)으로 바꿀지(기존 페이지 1파일 수정 필요).
- 기관관리자(org_admin)가 같은 경로를 쓰므로 현재 코치에서만 켬 — SDD-321 병합 시 역할 조건(`shouldApplyCoachScope`) 합의 필요.
