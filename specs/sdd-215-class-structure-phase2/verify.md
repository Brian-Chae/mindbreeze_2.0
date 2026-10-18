# SDD-215 Verify — 구현 전 검증 계약

- 상태: **Stage ③ 작성 완료·사용자 승인 대기 / 구현 전 작성**
- 작성일: 2026-10-19
- 기준: [spec.md](spec.md), [plan.md](plan.md)
- 아래 V/VR 검증은 모두 **계획·미실행**이다. 문서 정적 검증과 GitHub CI만 이번 종료 보고에 별도로 기록한다.

## 1. 승인 게이트와 테스트 경계

U-215-01에서 10개 읽기 화면·후속 기능 제외·상담 임시 표시·원 시안과의 차이를 승인한 뒤 구현한다. T01에서 K-01 최종 정적 계약을 확인한 후 테스트 fixtures를 고정한다. 미확인 필드를 존재하는 API 필드처럼 만든 테스트는 증거로 인정하지 않는다.

테스트는 localhost 앱·정적 HTML·합성 사용자/API 응답만 사용한다. 외부 네트워크, DB·AWS·dev/prod, 실제 메일·녹음·BLE는 사용하지 않는다. 이후 실환경 검증은 별도 승인 사항이며 이 검증 결과로 대체하거나 완료를 주장하지 않는다.

- 역할: counselor, org_admin, client, platform_admin, 미인증. API 권한은 Phase 1 반환 범위 이상으로 넓히지 않는다.
- 데이터: 실제 생성 기본형 1회 fixed, 확인된 메타가 있는 행, 선택값 null/누락/0, 빈 목록, 404/오류, 서로 다른 가시 범위, 종료 회차+active 클래스.
- 다회차/rolling/변경된 진행자/취소 seq 간격은 **합성 표시 검증용**이다. 실제 생성·멤버십·변경 기능 제공의 증거가 아니다.
- 기존 세션 링크는 가산 필드 4종이 모두 있는 경우와 전부 없는 경우를 포함한다. 상담 관계 ID는 세션 응답에서 추측하지 않는다.

## 2. 기능·회귀 시나리오

모든 행의 상태는 미실행이다. 실패 시 담당 파일 소유자에게 전달하고 동일 입력으로 재검증한다.

| ID | 입력·행동 | 통과 기준 | 종류 | 담당/작업 |
|---|---|---|---|---|
| V-01 | 5종 GET 응답·nullable·역할별 필드 정적 대조 | 실제 계약과 타입/fixtures 일치, 필수 ID·권한 미확인 0. 선택 누락은 명시 | 수동 비교 + vitest | D/T01~02 |
| V-02 | 값 0·false·null·누락, 빈 배열, 오류 | 0/false 보존, 누락은 데이터 없음, 빈 목록/오류 혼동 0 | vitest | D/T03 |
| V-03 | CH01 목록·검색·상태 필터 | 부모 1건=1행, 현재 로드 목록만 검색, 전체 합계 날조 0, 상세 N+1 요청 0 | vitest + Playwright | H/T07 |
| V-04 | CH02 active 클래스+완료 회차·집계 누락 | 클래스 자동 완료/개인 수료 판정 0, 누락 진행률 데이터 없음, 후속 탭/쓰기 CTA 0 | vitest + Playwright | H/T08 |
| V-05 | CH03 표↔타임라인·취소·seq 1/3/7 | 두 뷰 동일 가시 행·순번, 취소를 결석으로 바꾸지 않음, 행이 올바른 세션 상세로 이동 | vitest + Playwright | H/T08 |
| V-06 | MC01 명상만/상담만/둘 다/없음/한쪽 실패 | 두 메뉴 항상 노출, 유효 일정만 비교, 부분 실패를 전체 빈 상태로 표시하지 않음 | vitest + Playwright | M/T09 |
| V-07 | 상담사 연결 없는 client의 새 홈·부모 경로 | 강제 연결 화면으로 차단하지 않음, 빈 안내 가능, 기존 연결·세션 경로 유지 | Playwright | M·F/T09·T13 |
| V-08 | MC02 목록에 멤버십 정보 없음 | 참여 중/수료/이탈 개인 상태 추론 0, 누락값 데이터 없음, 부모 상세 이동 | vitest + Playwright | M/T10 |
| V-09 | MC03 출석/합류/보강 미제공·취소 회차 | 참석·결석·합류 전·보강 완료를 생성하지 않음, 원본 seq 유지, 리포트 탭 없음 | vitest + Playwright | M/T10 |
| V-10 | CN01·CN07 임시 관계·빈 목록·조회 오류 | 가짜 내담자별 관계/이름·누적 이력 0, 상담 일정 중심 표시, 호스트 내담자 링크는 `/clients` | vitest + Playwright | C/T11 |
| V-11 | CN02·CN08 client 가시 회차만 2/5번 반환 | 타인 행·개인 누적 횟수·보관/종결 주체 추정 0, 원본 번호 유지, 기록/리포트 본문 노출 0 | vitest + Playwright | C/T12 |
| V-12 | 타인 ID와 미존재 ID가 같은 404 | 상태·문구·복귀 동작 동일, 식별정보 노출 0 | vitest + Playwright | D·Q/T04·T14 |
| V-13 | client→호스트 URL, 호스트→회원 URL, platform_admin, 미인증 | 현재 RoleGuard 경계 유지, 허용 역할만 화면 진입; 거부 시 보호 데이터 렌더링 0 | Playwright | F/T13 |
| V-14 | 늦은 응답 중 로그아웃/계정 전환/빠른 부모 이동 | 이전 계정·부모 데이터 표시 0, 취소된 요청의 오류 배너 오염 0 | vitest + Playwright | D/T04 |
| V-15 | 새 화면 진입·탭·검색·재시도·뒤로 | 허용 GET만, 새 화면 자체의 POST/PUT/PATCH/DELETE 0. 기존 화면 이동 후 동작과 구분 | Playwright | Q/T14 |
| V-16 | 기존 세션 URL 직접 진입·새 부모에서 회차 선택 | `/sessions`→`/classes`, `/sessions/new`→`/classes/new`, `/sessions/:id`→부모 해석 경로(실패 시 `/classes`), `/app/sessions`→`/app/classes`로 이동. 입장/live/player/record 경로는 동작 유지. 회차 상세는 새 경로에서 축소 형태로 표시 | Playwright + 수동 비교 | F·Q/T13~14 |
| V-17 | `class_id·class_title·seq·area` 유무/미지 area | 가산 필드 없는 구 DTO도 기존 상세 이동, 타입명 기반 영역 추정·상담 ID 추정 0 | vitest | D/T03~04 |
| V-18 | 기존 session/report/chat 알림과 새 부모 대상·알 수 없는 target | 기존 목적지/입장 이벤트 동일, 부모 ID 유효할 때만 새 경로, 미지 대상 안전 처리 | vitest + Playwright | F/T05·T13 |
| V-19 | 3곳 내비에서 라벨 변경·활성 경로·배지 변경 | key 기반 active/배지/권한 유지. 영역 미확인 초대는 공통 알림, 이중 집계 0. 리포트는 더보기에서 접근/배지 유지 | vitest + Playwright | F/T05·T13 |
| V-20 | 혼합 홈·상담 본문·공통 내비 용어 검사 | 공통/명상/상담 검사 경계 명확, banned 위반 0, 명상 내비 때문에 상담 본문 가드를 끄지 않음 | vitest + Playwright | F/T06 |
| V-21 | 문구/오류/툴팁/aria-label·모바일 드로어 | 개발 용어·서버 오류 원문·시안 인덱스 미노출, 새 용어는 terms 기반. 기존 기본 키 결과 보존 | vitest + 수동 비교 | F·Q/T06·T14 |
| V-22 | LINK BAND 없음·BLE 미지원·녹음 없음 | 10개 읽기 화면과 기존 상세 이동 정상, 연결 강제·0점·오류 강조 0 | Playwright | Q/T14 |
| V-23 | 기존 셸 위에 새 페이지·상담의 내담자 링크 | 셸/헤더/하단 내비 중복 0, `/clients` 독립 페이지 유지, 기존 하네스/세션 화면 변형 없음 | Playwright + 수동 비교 | F·Q/T13~14 |
| V-24 | 키보드 Tab/Shift-Tab/Enter/Escape, 모바일 터치 | 모든 조작 가능, 초점 표시·복귀 정상, 드로어 닫기 가능, 비활성 요소 오동작 0 | Playwright + 수동 비교 | Q/T14 |
| V-25 | 변경 전후 관련 단위 테스트·빌드·린트 | 새 실패 0, 기존 실패는 이름/원인/전후 결과 분리. 금지된 파일 변경 0 | vitest + 수동 비교 | F·Q/T00·T15 |

V-16의 대상 URL 목록(이동 확인 + 유지 확인): `/sessions`, `/sessions/new`, `/sessions/:id`, `/sessions/:id/live`, `/sessions/:id/player`, `/sessions/:id/record`, `/app/sessions`, `/app/sessions/:id`, `/join`, `/class/:sessionId/enter`, 기존 `/reports`·`/app/reports` 진입. 기존 세션 상태 ready/scheduled/open/in_progress/completed/cancelled는 현행 계약에서 확인 가능한 fixture로 점검하며 없는 상태를 임의 추가하지 않는다.

## 3. 시안 케이스 전수 매핑

확인 출처는 host HTML의 `reg('CH..')`, member HTML의 `REG`, counseling HTML의 `INDEX`다. ID 없는 화면을 추측하지 않는다. 아래 **81개**가 이번 10개 화면의 전체 등록 case다.

- R: 읽기 대상으로 비교. 원 시안의 공통 가정(시연 수치, 후속 탭, 15분 CTA 등)은 Spec에 맞춰 보정한다. 원 시안 전체 기능 제공을 뜻하지 않는다.
- A: 구조 비교는 하되 제공되지 않는 데이터/상태를 제거하거나 ‘데이터 없음’으로 바꾼다. 차이 사유와 영역을 기록한다.
- X: 후속 기능이라 제품 상태/조작을 만들지 않는다. 인접 기본 화면에서 해당 진입 버튼·시트가 없음을 검증한다. 제외를 통과 캡처로 세지 않는다.

| 화면 / 시나리오 | R: 읽기 비교 | A: 계약에 맞춘 보정 비교 | X: 제외·이유 | R+A / X |
|---|---|---|---|---|
| CH01 / VR-01 | open, progress, idle, filter-draft, search, done, empty | warn: 강사 경고 데이터 없으면 데이터 없음, 지정 CTA 없음 | 없음 | 8 / 0 |
| CH02 / VR-02 | overview, open, draft, done | warn, rolling: 미제공 경고/자동 생성 설명 제거 | 없음 | 6 / 0 |
| CH03 / VR-03 | table, timeline, cancelled | makeup, rolling, pending, needs-reassign: 알려진 회차만, 보강/수락 정보 데이터 없음 | reassign, host-change, host-conflict, host-urgent, makeup-add: 편성·변경 시트 | 7 / 5 |
| MC01 / VR-04 | class-open, class-soon, class-upcoming, counsel-next, only-class, only-counsel, empty | invited: 클래스 멤버 초대 추정 금지, 기존 확인된 초대 링크만 | 없음 | 8 / 0 |
| MC02 / VR-05 | list, empty | left-open, waitlist, invited: 개인 상태 구역/칩 미생성, 읽기 목록·데이터 없음 | apply: 새 신청 시트 | 5 / 1 |
| MC03 / VR-06 | ongoing, cancelled | makeup-planned, makeup-done, joined-mid, host-changed, rolling, completed, left: 개인 이력/완료 추정 금지 | makeup-pick: 보강 선택 시트 | 9 / 1 |
| CN01 / VR-07 | active, clients, search, search-empty, empty, net | closed, closed-archived: 제공 상태만, 종결/보관 정책 자동 구현 금지 | 없음 | 8 / 0 |
| CN02 / VR-08 | active, ongoing, net | recurring, closed, archived: 가시 일정만, 반복/종결 조작·개인 관계 의미 제외 | guest-pending, guest-active, guest-expired, closed-guest, scrubbed: 비회원 자격·개인정보 수명 | 6 / 5 |
| CN07 / VR-09 | list, empty, net | list-open, invited: 개인별 종결/초대 관계 추정 금지 | 없음 | 5 / 0 |
| CN08 / VR-10 | active, ready-now, no-next, net | report-waiting, closed-me, closed-counselor: 상태만, 본문·종결 주체·재개 기능 없음 | 없음 | 7 / 0 |
| 합계 |  |  |  | **69 / 12** |

CN01 clients의 제품 대응은 상담 안의 내담자 링크와 기존 `/clients` 목적지다. 새 내담자 탭 화면을 복제하지 않는다. 비교 대상은 링크가 있는 상담 셸이며 기존 내담자 화면은 별도 회귀 대상으로 기록한다. R의 open/ready-now는 기존 상세로 이어지는 읽기 진입점이지 새 입장 시각 판정 기능이 아니다.

각 case의 원본 URL은 `designs/class-structure-redesign/<파일>.html?screen=<ID>&case=<case>`다. 상담은 `role=host|member`, 호스트는 필요 시 `k=<HTML에서 확인한 값>`을 manifest에 고정한다. class 데이터 변형 k를 임의 생성하지 않는다. 이 표 외 화면/외부 case는 **미확인** 또는 Spec의 후속 범위로 기록한다.

## 4. 4개 뷰포트·픽셀 비교 절차

### VR-11: 캡처 환경과 원본 보존

1. Chromium·OS/폰트 버전, DPR=1, locale=ko-KR, timezone=Asia/Seoul, 고정 시계, reduced motion, 색상 모드를 기록한다. 동일 브라우저에서 시안/앱을 캡처한다.
2. **390×844 / 834×1194 / 1194×834 / 1280×720**을 정확히 사용한다. 셸 내 전체 화면과 스크롤 내용의 끝까지 별도 확인한다.
3. 원본 HTML은 수정하지 않는다. `document.fonts.ready`, 이미지 로딩, 앱 로딩 종료를 기다린다. 네트워크 오류·빠진 토큰/이미지·콘솔 오류가 있으면 캡처를 통과로 인정하지 않는다.
4. 시연 인명/숫자를 실제 운영 데이터로 쓰지 않는다. 확인된 응답 계약으로 만든 fixture와 기대 문구를 manifest에 남기고, 원본과 다른 ‘데이터 없음’·삭제 CTA·용어 치환은 승인된 차이 목록에 연결한다.

통과 기준: 환경·원본 SHA·앱 SHA·fixture·URL·화면/case·뷰포트가 각 이미지와 1:1로 추적된다. 종류: **Playwright + 수동 비교**. 담당 Q.

### VR-12: 픽셀 차이 및 수동 판정

1. R/A 69개 × 4뷰포트 = **276쌍**의 원본/앱 캡처를 만든다. 같은 크기로 픽셀 diff와 50% 중첩 이미지를 만든다. 앱 캡처를 원본 기준 이미지로 자동 승인하지 않는다.
2. 전체 화면을 나란히/중첩 비교하고 셸 폭·헤더/본문 시작점·카드/표 정렬·간격·타이포·색·그림자·아이콘·스크롤 영역을 확인한다. 삭제한 후속 탭 등으로 생긴 재배치도 별도 설명한다.
3. 승인된 의미 차이 밖의 공통 영역은 픽셀 색상 차이 threshold=0.2, 최대 차이 비율 **0.1%**를 초기 기술 기준으로 사용한다. 이는 원문 수치가 아닌 이번 검증 설계다. 중요 정렬점 위치 오차는 **2px 이하**로 측정한다.
4. 초과하면 실패로 기록하고 폰트/이미지/레이아웃 원인을 확인한다. 의도 차이는 사유·영역 좌표·근거·검토자를 명시한다. 페이지 전체나 본문 전체를 마스킹해 통과시키지 않는다. ‘데이터 없음’ 치환 영역도 사람이 전체 레이아웃을 확인한다.
5. 대체 문구·숨긴 CTA 등 기능상 차이는 범위 승인에 포함하되, 구현에서 새로 생긴 미승인 시각 차이를 범위 차이라고 자동 처리하지 않는다. 원본 시안을 변경하거나 임계값을 올려 실패를 없애지 않는다.

통과 기준: 276쌍 누락 0, 설명 없는 차이 0, 기준 초과 미해결 0, 모든 의도 차이 수동 검토 완료. 종류: **Playwright 픽셀 비교 + 수동 비교**. 담당 Q, 수정은 해당 파일 소유자.

### VR-13: 전체 fit·접근성·균형

각 R/A case와 아래 보완 상태를 모두 측정한다. 글자 최소 12px, 상호작용 유효 영역 44×44px 이상, 인접 hit 영역 오동작 0, 페이지 가로·세로 넘침 0. 목록/표만 셸 내부 스크롤을 허용하고 끝 행·CTA가 헤더/하단 탭에 가리지 않아야 한다. 8px 간격 체계, 같은 종류 카드/제목의 정렬과 좌우 여백 균형을 확인한다. 소수점 반올림 외 의도 차이는 근거를 기록한다.

12px 기준을 맞추려고 본문 가독성을 기존 시안보다 줄이지 않는다. pseudo-element로 확장한 hit 영역은 실제 클릭 검증도 한다. 키보드 초점·스크린리더 이름·색상만으로 상태 구분하지 않는지도 V-24와 함께 수동 확인한다.

통과 기준: fit/터치/텍스트 잘림/중복 셸/균형 위반 **0**, 케이스 일부만 확인한 결과를 전체 통과로 보고하지 않음. 종류: **Playwright 측정 + 수동 비교**.

### VR-14: API 상태 보완과 X의 부재 검증

10개 화면 각각에 loading, error, successful-empty, missing-fields, no-band, long-content **6개 합성 상태**를 추가하고 4뷰포트에서 확인한다. 상세의 successful-empty는 가시 회차가 없는 정상 상세, 목록은 빈 배열이다. 이는 시안 case ID가 아닌 테스트 시나리오다. 추가 앱 캡처는 **10×6×4=240장**, R/A와 파일명을 구분한다. 404·계정 전환 등 동작은 V-12~14로 별도 확인한다.

X 12개는 대응 기본 화면에서 버튼/시트/쓰기 요청 부재를 검증하고 `excluded_reason`을 남긴다. 성공한 12개 화면처럼 이미지 수를 부풀리지 않는다. no-band는 missing-fields와 구별하며 장치 없음 자체를 데이터 오류로 표시하지 않는다.

통과 기준: 추가 240장과 상태별 기대 결과 누락 0, X 12개 제외 사유·부재 검증 누락 0. 종류: **Playwright + 수동 비교**.

## 5. 증거와 판정 형식

후속 구현 승인 후 Q가 `frontend/e2e/class-structure/` 아래 실행 경로를 설정한다. 캡처 산출물은 Git 추적 여부를 먼저 정하고 QA 전용 경로에 저장하며 원본 시안을 덮어쓰지 않는다. **이번 문서 PR에서는 이 경로에 파일을 생성하지 않는다.**

manifest 필드: `screen_id`, `case_id`, `classification(R/A/X)`, `role`, `prototype_url`, `app_url`, `fixture_id`, `viewport`, `source_sha`, `app_sha`, `expected_copy`, `allowed_difference`, `excluded_reason`, `reference_image`, `actual_image`, `diff_image`, `overlay_image`, `pixel_diff_ratio`, `fit_violations`, `reviewer`, `result`.

- 기본 최소 증거: 원본 276장 + 앱 276장 + diff 276장 + overlay 276장. 보완 앱 240장. 앱 캡처 합계 **516장**. 중복 상태여도 각각의 manifest 행과 증거 연결은 유지한다.
- 결과는 시나리오별 PASS/FAIL/BLOCKED/미실행과 근거를 기록한다. 화면 ID 미확인은 미확인으로 남기며 PASS로 바꾸지 않는다.
- 사용자 승인, 픽셀 비교, DOM 측정, 모의 API 기능 테스트, 실제 서비스 검증은 서로 다른 증거다. 하나로 다른 항목을 대체하지 않는다.
- 실패 수정 후 변경된 화면의 관련 case×4뷰포트와 영향을 받은 회귀 검증을 다시 실행한다. 오래된 캡처/다른 SHA의 PASS를 최종 증거로 쓰지 않는다.

## 6. 이번 문서 전용 검증

| ID | 확인 항목 | 통과 기준 | 종류 |
|---|---|---|---|
| DOC-01 | 첫 줄·세 문서·승인 상태 | 지정 제목 보존, 구현 전 Verify, 승인 대기/미실행 명시 | 정적 수동 비교 |
| DOC-02 | 시안 등록부·ID·case | 10개 화면/81 case가 실제 등록과 일치, 69+12 합계, 추측 ID 없음 | 정적 스크립트 + 수동 비교 |
| DOC-03 | 파일 소유/작업 의존성 | 파일별 소유자 1명, 공통 파일 중복 0, 각 작업에 검증·담당 지정 | 정적 스크립트 + 수동 비교 |
| DOC-04 | 데이터·용어·회귀·미확인 | 5 API·4 가산 필드, placeholder 제한, 사전/금지어 분리, 기존 URL·no-band 보존 | 수동 비교 |
| DOC-05 | git 경계·공백·PR | 지정 폴더만 변경, `git diff --check` 통과, docs(sdd-215) 커밋, 작업 브랜치→develop PR, 머지 없음 | git/GitHub 조회 |
| DOC-06 | 해당 SHA의 CI | workflow/job/step 종료 확인, 비차단 실패도 별도 보고. 미실행/실패를 통과로 쓰지 않음 | GitHub 조회 |

문서의 완료와 Stage ④~⑦의 완료는 구분한다. 현 시점 V-01~25·VR-01~14는 **미실행**, U-215-01은 **승인 대기**, 실제 서비스 동작·픽셀 결과는 **미확인**이다.
