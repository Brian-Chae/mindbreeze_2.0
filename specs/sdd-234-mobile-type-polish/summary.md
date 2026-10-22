# SDD-234 — 공통 기반 결과와 후속 인계

## 완료 범위

공통 기반만 완료했다. 화면별 A~D 구현은 plan.md의 담당 워커에게 인계하며, 전체 SDD 출시 완료가 아니다.

- before/after 각각 20화면 × 390/768/1440px = 60개. 실제 앱 셸 포함, 독립 flow/player 하니스는 JSON shell로 구분.
- 합성 API만 사용. 렌더·JS 오류·미등록 API 모두 0. 서버·DB·.env·메일·배포·PR 생성 없음.
- 모바일 의미 토큰 8종, 상단 셸 터치 44px, 하단 라벨 13px, 셸 제목 22px/보조 13px, 일반 입력 최소 높이48 적용.
- 기존 sm15/22, 홈 카드 반경·패딩·152/304px 높이, 색상·폰트 계열·기능·문구 유지.

## 실측 목록

- [변경 전 390px 표](before-390.md), [공통 변경 후 390px 표](after-390.md).
- `screens/{before,after}/[A-D]-화면-390.json`의 `violations.smallText`, `belowSecondary`, `smallTouch`, `narrowTouch`, `irregularSpacing`에 모든 후보의 text/selector/class/계산 크기 수록.
- `spacing`: 카드·섹션 padding/margin/gap. `sectionGaps`: 형제 사이 실제 수직 거리. 4px 단위 미일치는 검토 후보이며 홈 패딩18/칩 gap6은 예외.
- 작은 글자 비율은 12px 이하 직접 텍스트 요소 수 / 전체 직접 텍스트 요소 수. 숨김·aria-hidden·모달 배경 제외. 본문15/16 의미 판정은 워커가 별도로 확인한다.

## 검증

- 관련 vitest 7파일/62개 통과. tsc와 변경 TSX eslint 통과. 전체 vitest는 실행하지 않았다.
- check-tokens: 390/767px 의미 토큰 8종 size/leading, 768/1440px 기존 sm15/22 확인.
- check-foundation: 전체60개, 모바일108건(셸/탭/입력), 데스크톱120건(raw texts/touches/spacing 비교), 실패0.
- 독립 리뷰가 diff·측정값·토큰 검사를 확인했다. 후속으로 입력48 강제와 한글 제목 단어 줄바꿈을 보완하고 모바일 재측정했다.
- 홈 화면·채팅 화면의 실제 캡처 확인. 긴 홈 인사말은 22px에서 두 줄로 표시된다.
- 근거 파일: `checks/`와 `screens/`.

## 제한 및 함정

- OS fallback 글꼴의 Chrome headless 측정. 실기기/iOS 키보드/200% 확대/BLE/LiveKit/실서비스 API 증거가 아니다. 후속 영역 및 통합 검증에서 확인한다.
- 기존 토큰 전체 빌드는 수동 유지된 preset 및 light/dark 출력과 불일치했다. 해당 무관 변경을 되돌리고 이번 mobile 원본/base CSS/TS 추가분만 유지했다. 전체 토큰 재빌드 시 기존 drift부터 해결해야 한다.
- 채팅 다크 FIX의 ChatRoom.tsx·ClassChatPanel.tsx는 D와 충돌 가능. 색상·테마 조건을 보존하며 순차 통합한다.
- Brian의 추가 비즈니스 결정은 필요하지 않다. 후속 A~D 구현 및 최종 검증이 남아 있다.

## 재실행

```bash
node specs/sdd-234-mobile-type-polish/measure.cjs --area=A --phase=after-a --widths=390,768,1440
node specs/sdd-234-mobile-type-polish/check-tokens.cjs
node specs/sdd-234-mobile-type-polish/check-foundation.cjs after
node specs/sdd-234-mobile-type-polish/test-related.cjs
```

기존 출력 디렉토리는 기본 보호된다. 의도한 재측정만 `--overwrite`. check-foundation은 전체60개를 요구한다. 부분 측정은 화면별 JSON을 검토한다. 원본 before를 후속 구현 결과로 덮어쓰지 않는다.

## 공통 구현 커밋

`950bbdc8` — 모바일 토큰 원본·CSS/TS 출력, Tailwind mobile 변형, index.css·mobile-foundation.css, AppShell/ClientShell, floating-bottom-nav.css, DESIGN.md (10파일).

최종 독립 재검증도 60/108/120 실패0. 관련 vitest 최종 재실행 62/62. 상세 결과는 checks/에 보존했다.

## 2단계 통합 (10/23, 감독)

- 영역 브랜치 4개(sdd/234-a-home `cb70335b`, b-class `f5eabf41`, c-report `79d32820`, d-chat `fea84a11`)를 공통 기반 위에 병합. 충돌 0.
- 통합 중 고친 기존 테스트 3건(제품 코드 변경 없음):
  - `class-player-member-sheets.test.tsx`: PR #62에서 바뀐 조용한 신호 안내 문구('선택한 상태와 이름이 상담사에게만 보여요')로 기대값 갱신. develop에서도 실패하던 건.
  - `font-scale.test.ts`: D가 말풍선 크기를 인라인 → `chat-room.css` 클래스로 옮김에 따라, 데스크톱 기본값(15/13/12px·최대폭 80%)과 muted 색 폴백을 CSS·컴포넌트에서 확인하도록 변경.
  - `specs/sdd-233-home-stats-floating-nav/parity.cjs`: PR #60 레일 카드(`.home-rail-card`)는 일반 패널 최소높이 200 비교에서 빼고 최소높이 0을 따로 확인. 두 홈 390·1440 실패 0.
- 통합 측정 `screens/after-integrated` (390·768·1440, 20화면×3):
  - 390px 12px 이하 글자 241 → 3(홈 레일 배지·아바타 — PR #60 유지 대상), 최소 글자 11~12 → 13(홈 12 유지 요소 제외), 44px 미만 터치 → 채팅 목록 정렬 체크박스 1(라벨 전체 44px 터치라 실사용 충족). 렌더/JS 오류 0.
  - 768·1440: 현재 develop을 같은 하니스로 측정한 기준과 비교해 40개 화면 분포 차이 0(데스크톱 불변). 원래 before와의 차이 6건은 그 사이 develop에 들어간 PR #60·#62 때문.
- 검증: tsc 0, 빌드 통과(.env 미로드 Node API). 전체 vitest 2,631 중 실패 11 — 모두 develop 동일 실패(agent-counselor-page, chat-message-deeplink, org-*browser, report-*pdf; 로컬 서버 필요한 브라우저 테스트 포함).
- 남은 확인: 실기기(iOS 키보드·safe-area·200% 확대), 클래스 안 채팅 패널 실측.
