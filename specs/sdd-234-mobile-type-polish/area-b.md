# SDD-234 B 클래스 작업 기록

- 기준: `sdd/234-b-class`의 작업 시작 HEAD. 기존 before는 최근 host 수정 이전이므로 `screens/before-b/`도 별도 보존했다.
- 승인된 B 소유 파일만 수정. 홈에서 공유하는 MemberClassStyles는 `.mc-stack:not(.mh-home)`로 한정했다.
- host 플레이어는 이미 보조 하한 13px이므로 수정하지 않는다. 공용 플레이어 보정도 `.hp-shell`은 제외한다.
- 실행 계획: 기존 기준 확인 → 모바일 CSS/의미 토큰 → 관련 테스트/30화면 측정 → 시트·장문 보완 → 독립 리뷰 → 지정 브랜치 push.
- 신규 Chrome 회귀 테스트: 모바일 390/767에서 12px 하한 실패(RED), 적용 후 4/4 통과. 768/1440 기존 크기 유지.
- 1차 측정: 390px 10화면 작은 글자/터치/가로 넘침 0. 768/1440은 클래스 문자열 추가 외 모든 계산 크기·위치 동일. host 모바일 texts/touches/spacing 완전 동일.
- 5444 포트는 다른 작업이 사용 중이므로 점유 프로세스를 건드리지 않고 measure.cjs를 메모리에서만 5544로 치환해 실행했다. 공통 측정 파일은 변경하지 않았다.
- 최종 검증 결과와 제한은 아래에 기록한다.

## 추가 상태 보완

- 동의 폼/기록 상세 시트, 회원 기기/상태 시트, 상담사 초대/밴드 시트, 긴 한글·URL 및 글자 200% 확대를 추가 캡처했다(`screens/extra-b/`, 각 390/768/1440).
- 밴드 접촉 상태 5개가 12px로 남아 SensorTracker의 로컬 CSS 변수(모바일 공통 caption 토큰 참조)로 13px 보정. 데스크톱 12px 유지 Chrome 테스트 RED→GREEN.
- 상담사 밴드 착용 안내 본문은 13→15/24, 로비 조작 라벨은 13→14/20. host 진행 플레이어 배치에는 영향 없음.
- 클래스 리포트 내부 상태·집계 메타에 mobile caption을 적용. 기능·상태·문구·점수 변경 없음.
- `class-player-member-sheets.test.tsx:180`은 기존 문구 기대값 불일치. 시작 HEAD의 QuietSignalButtons는 이미 '선택한 상태와 이름이 상담사에게만 보여요'이고 테스트는 이전 문구를 기대한다. 본 작업에서는 둘 다 변경하지 않았다.

## 전후 실측 (390px, 현재 브랜치 기준)

| 화면 | 최소 글자 전→후 | 12px 이하 전→후 | 44px 미만 터치 전→후 |
|---|---:|---:|---:|
| 회원 목록 | 12→13 | 4→0 | 0→0 |
| 상담사 목록 | 12→13 | 6→0 | 0→0 |
| 회원 상세 | 12→13 | 2→0 | 0→0 |
| 상담사 상세 | 12→13 | 1→0 | 0→0 |
| 회원 입장 | 13→13 | 0→0 | 0→0 |
| 상담사 입장 | 12→13 | 2→0 | 0→0 |
| 회원 로비 | 13→13 | 0→0 | 0→0 |
| 상담사 로비 | 13→13 | 0→0 | 0→0 |
| 회원 진행 | 12→13 | 9→0 | 0→0 |
| 상담사 진행 | 13→13 | 0→0 | 0→0 |
| 합계 | 하한 13 | 24→0 | 0→0 |

- 일반 독립 터치는 최소 44×44 유지. 회원 목록 ‘클래스 신청하기’ 주 CTA는 높이 44→48, 기존 입장 CTA는 48 이상 유지.
- 카드 설명 14→15/24, 장치 안내 13→15/24, 입장 안내 15→16/26, 라벨 13→14/20. 회원 카드 제목은 18/27로 위계 통일.
- 추가 상태: 7화면 × 3폭 = 21개. 모바일 작은 글자·터치 후보·가로 넘침 모두 0. 밴드 접촉 상태는 추가 검증 중 발견한 5개를 12→13으로 보정했다.
- 768/1440 기본 20화면: texts/touches/spacing에서 class 문자열만 제외하면 완전 동일. host 진행은 390에서도 동일(폭·높이·위치 포함).
- 장문은 합성 제목·URL을 DOM에 주입하고 `.mc-stack`의 글자 및 행간을 2배로 설정했다. 내부 스크롤 끝에서도 개요/회차와 카드 링크가 접근 가능하고 문서 가로 넘침 0. 실제 브라우저 메뉴 줌/실기기 확대 증거는 아니다. 글자만 2배로 강제하고 행간을 고정한 실험에서는 줄 겹침이 보였으므로 그 극단적 사용자 CSS 조건까지 해결했다고 주장하지 않는다.
- 스크린샷 직접 검토: 회원 목록/진행, 밴드 접촉 시트, 고지 상세 시트, 장문 스크롤 끝. 시트 애니메이션 종료 후 캡처했으며 기존 불투명 배경과 구조 유지.

## 변경 파일

`frontend/src/` 기준:

- `pages/classes/{host-classes-page,host-class-detail-page}.tsx`
- `pages/client/member-classes-page.tsx`
- `components/class/structure/{host-class-views,member-class-views,class-report-manage,class-session-summary}.tsx`
- `components/class/structure/structure-shell.css`
- `components/class/flow/{shared/flow-shared,member/member-flow,host/host-flow-live}.css`
- `components/class/player/{shared/player-shared,member/member-player}.css`
- `components/class/SensorTracker.tsx`
- 신규 테스트 `frontend/tests/sdd234-b-{mobile-type,measurements}.test.tsx`
- 본 문서 및 `screens/{before-b,after-b,extra-b}/` JSON·PNG.

## 공통 요청·잔여 사항

- 필수 공통 파일 요청 없음. A 홈/공통 토큰/공통 셸/채팅 내부 수정 없음.
- 기본 10화면과 추가 7상태의 모바일 하한·터치 잔여 후보 0. 미측정 모든 상태까지 전수 보장하지 않는다.
- 768/1440 기존 작은 글자와 일부 44px 미만 링크는 범위 밖이므로 유지했다.
- CSS gap6 등 기존 간격 후보는 의미 있는 칩 간격으로 유지. host 배치·고정 치수 변경 없음.
- 실제 서버/API·DB·BLE·LiveKit·실기기·iOS 키보드는 검증하지 않았다. 외부 연결을 차단한 합성 하니스 결과다.
- 독립 리뷰: 첫 구현 커밋의 diff와 30개 JSON을 검토해 중요 결함 없음, 데스크톱/host 계산값 보존을 확인했다. 이후 밴드/본문/CTA 보완은 신규 Chrome 테스트와 측정 비교로 직접 재검증했다.

## 검증 명령과 결과

- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`: 통과.
- 변경 TSX 전체 및 신규 테스트 ESLint: 통과. `git diff --check`: 통과.
- `npm run build`의 두 단계(`tsc -b`, Vite build)를 동일하게 수행하되 Vite Node API에 빈 `envDir`와 워크트리 design-system alias를 전달했다. `.env` 금지 때문에 원본 npm 명령을 그대로 호출하지 않았다. 빌드 성공; 기존 번들 크기·정적/동적 import 중복 경고 유지.
- 관련 회귀는 `class-flow-*`, `class-player-*`, `member/host-class-structure`, `host-topbar-class-code`, `sdd219-report-tab`, `sdd234-b-*`를 Vitest Node API로 실행(빈 envDir, maxWorkers=4). 저장소 전체 Vitest는 실행하지 않았다.
- 신규 테스트: 실제 Chrome computed style 5개 + 저장된 30화면 계산값/총개수 비교 31개. 모바일 390/767 및 desktop 768/1440 포함.
- 주 CTA는 셸의 `.cs-structure button { min-height:44px }`가 일반 Tailwind보다 우선하므로 해당 버튼에만 `mobile:!min-h-[var(--mobile-touch-control)]`를 적용했다. 실제 높이 44 실패 → 48 통과, desktop 계산값 동일.
- 측정 재실행은 기존 `measure.cjs`를 Module._compile로 실행하며 문자열 `5444`만 `5544`로 메모리 치환했다. 기본 인수: `--area=B --phase=after-b --widths=390,768,1440` (의도적 최종 갱신만 `--overwrite`). 원본 before와 공통 스크립트는 변경하지 않았다.
- 추가 측정은 동일 수집기에 아래 라우트를 주입했다. 고지 상세는 `기록 안내 자세히 보기` 클릭 후 400ms 애니메이션 대기. 장문은 DOM 합성 데이터만 변경했다.

| 상태 | 라우트/동작 |
|---|---|
| 동의 | `/design/class-flow?screen=FM06a&case=on-group-opt-member` |
| 고지 상세 | 위 화면에서 기록 안내 자세히 보기 |
| 회원 기기 | `/design/class-player?role=member&case=M02&sheet=device` |
| 회원 상태 | `/design/class-player?role=member&case=M02&sheet=status` |
| 상담사 초대 | `/design/class-flow?screen=FH06a&case=invite` |
| 상담사 밴드 | `/design/class-flow?screen=FH06a&case=band-bad-lr` |
| 장문/200% | `/app/classes/sample-class`의 제목·URL 합성 및 글자/행간 2배 |

### 최종 결과

- 관련 Vitest **66파일 / 1,341 통과 · 기존 문구 단언 1 실패**(총 1,342). 신규 B 테스트 **36/36 통과**. 마지막 실패는 위에 기록한 `class-player-member-sheets.test.tsx:180` 한 건뿐이다.
- 기본 after 30 + 추가 21 = **51개 화면 측정**, 렌더/JS/미등록 API 오류 0. 390px 17화면의 작은 글자·작은 터치·좁은 터치·문서 가로 넘침 0.
- 타입·ESLint·빌드·diff 공백 검사 통과. 최종 프로덕션 빌드 2.25초(환경 의존).
- 코드 커밋: `4c02a003` 모바일 글자·행간, `0617b963` 시트·밴드·리포트 보완. 최종 검증/CTA/측정 산출물은 후속 feat 커밋에 포함한다.
- 요청된 frontend/node_modules 심링크만 제거한 뒤 `sdd/234-b-class`만 푸시한다. PR·머지·develop 푸시·배포 없음.
