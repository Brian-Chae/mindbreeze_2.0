# SDD-245 구현 전 검증 게이트

- 작성 시점: 2026-10-25, 제품 코드 구현 전.
- 상태: **게이트 정의 완료 / 구현 승인·구현 후 검증 미진행**. 체크박스는 미래 실행 항목이다.
- 기준 코드 `62017dd8`; 감사 viewport 390×844, 1440×900, Playwright `channel: 'chrome'`, 합성 데이터. 기기/백엔드/운영 증거가 아니다.

## 사전 기준선

- 현재 `npm test`: 272파일 중 264통과/8실패, 3,001테스트 중 **2,984통과/17실패**, exit 1, 169.17초. [실패 이름·파일](audit/vitest-baseline.txt).
- 실패군: 기관 모달 2, 기관 상담사 1, SDD234 desktop parity 4, report PDF 4, agent counselor 2, chat deeplink 2, native release 2. 실패 테스트를 수정/삭제/skip하여 이번 스타일 작업을 녹색으로 만들지 않는다.
- 실행이 SDD234 `screens/test-a`를 자동 갱신한다. 실행 전 status 기록, 실행 후 이 작업에서 생성된 변경만 복원. 이번 감사에서는 19개 추적 산출물 복원 확인.
- 감사용 Vite development mode 빌드 성공(제품 코드 미수정). 처음 저장소 루트에서 실행한 빌드는 Tailwind cwd 해석 실패였고, 도구에서 `process.chdir(frontend)`로 바로잡았다. 기존 토큰 import의 경로는 감사 빌드의 alias로 저장소 design-system을 해석한다. 일반 배포 빌드 통과를 주장하지 않는다.

## 재현 가능한 측정 명령

저장소 루트에서 실행한다. `frontend/node_modules`는 기존 심볼릭 의존성만 사용한다.

```bash
node specs/sdd-245-ui-unification/audit/build.cjs
node specs/sdd-245-ui-unification/audit/measure.cjs
```

- 빌드는 `/tmp/sdd245-build-*`에 저장하고 `.env`를 로드하지 않는다. `build-info.json`에 실제 빌드 경로·소스 SHA 기록.
- 모든 asset은 빌드 파일에서 route.fulfill, API는 합성 fixture, 미등록은 404, 인증 refresh 외 비GET은 405, 공개 폰트 CDN GET만 허용하고 나머지 외부 URL·WebSocket은 차단한다. 자동 발생한 쓰기 시도는 JSON `blockedWrites`에 남기며 외부 실행하지 않는다.
- route path 94개 + 수동 분기/보조 표본을 자동 인벤토리화한다. 각 role/view에 별도 context를 사용한다. 제어 요소 클릭·폼 제출 없음. hover만 포인터 이동.
- `getComputedStyle` + `getBoundingClientRect`: 셸/중첩 frame padding·max-width·x, 제목 font/weight/y/margin, 버튼/링크 전체, 카드, input/select/textarea, tabs/chips, section gap 원본 저장.
- 버튼형 카드와 일반 버튼을 구분한다. hover 대표는 64px 이하 normal primary/secondary/ghost/icon 후보에서 본문 요소를 우선한다. 해당 variant가 없으면 `not-present`, 실패하면 `not-hoverable`; 이를 통과로 간주하지 않는다.
- 같은 selector가 있어도 오류/권한/리다이렉트 화면은 목적 페이지 정상 상태의 증거가 아니다. coverage 상태표와 JSON 원문을 함께 검사한다. 렌더 오류/fixture 부족은 제품 문제로 단정하지 않는다.

## 자동 스타일 회귀 검사 스크립트 계약

구현 T1에서 `audit/assert-styles.cjs`와 `audit/style-targets.json`을 추가한다. 지금은 합격 수치를 임의로 채운 통과 스크립트를 만들지 않는다. 기존 감사 도구는 구현 후에도 동일 측정에 사용한다.

```bash
# 구현 승인 후, audit/build.cjs → audit/measure.cjs 재실행 결과를 별도 after 디렉터리에 보존
node specs/sdd-245-ui-unification/audit/assert-styles.cjs --measurements=specs/sdd-245-ui-unification/audit/after --targets=specs/sdd-245-ui-unification/audit/style-targets.json --tolerance=1
```

스크립트 필수 동작:

1. routes.json의 모든 role×viewport를 expected 집합으로 만들고 누락/중복/빈 배열/오류 화면을 실패 처리한다. redirect는 목적 경로까지 확인한다. 명시적 excluded route도 이유·캡처 필요.
2. `data-ui`/기존 접근 가능한 role selector를 audit selector에 매핑한다. 일치 요소 0개 또는 예상 밖 다중 매치는 실패. 첫 번째 요소로 조용히 대체 금지.
3. geometry: height, padding 4방향, 실제 좌측/우측 inset, max-width 적용 결과, section gap, 제목 y/상단 padding, font-size. `abs(actual-expected)<=1px`; 토큰 숫자·border-width·font-weight는 0 오차. 서브픽셀 bounding rect만 1px 허용.
4. radius의 `9999px`는 원시 선언과 유효 pill 기하를 구분한다. 직사각형 일반 버튼과 카드를 비교하지 않는다. box-shadow/rgb/rgba/font-family는 정규화 후 정확 일치. 고의적인 hover·inverse·danger variant는 독립 target.
5. `.mh-home`과 셸처럼 gutter가 다른 층에 있는 경우 합산 content edge를 비교하고 실제 padding 층도 별도 검사한다. padding 0과 40만 빼서 사용자 체감 여백 차이라고 주장하지 않는다.
6. 초과/불일치 목록을 route·role·viewport·selector·expected·actual·delta JSON/Markdown으로 저장, 1개라도 미승인 편차가 있으면 exit 1.
7. **독립 검증:** 선택한 홈·설정·클래스·데이터 센터에서 별도 짧은 page.evaluate로 x/width/padding을 재계산하고 주 측정기 결과와 대조한다. 측정기의 selector 오류도 잡는다.

## 검증 시나리오

| ID | 시나리오 | 통과 조건 | 담당 |
|---|---|---|---|
| UI-01 | 4역할 홈×2폭 | frame/타이틀 기준값·variant 실측, 홈 정보 구조 유지 | A+독립 검증자 |
| UI-02 | 모든 일반 경로×역할×2폭 | 페이지×항목 delta 0~1px, 미측정 없음 또는 승인된 권한/외부토큰 상태 명시 | B/C/D |
| UI-03 | 768/1024/1920 폭 | gutter 32/40 전환·max-width 중심 정렬, 중복 padding·가로 넘침 없음 | A |
| UI-04 | 버튼 4variant×3size | normal/hover/focus/disabled, native type/keyboard/aria 보존 | A |
| UI-05 | 카드/입력/select/탭/칩 | 토큰 수치와 색 일치, 클릭 칩44px/입력 모바일48px 하한 | B/C/D |
| UI-06 | 긴 한글 제목·200% 글자·빈/로딩/오류 | 겹침/잘림/수평 넘침 없음, 내용 순서 유지 | B/C/D |
| UI-07 | 공개 가입·정책·리포트·채팅 | 승인된 내부 읽기 폭·분할 레이아웃 예외 보존 | B/C |
| UI-08 | 로그인 FIX·몰입 플레이어 | 소유 파일 diff 0, 간접 스타일/기능 회귀 없음 | 감독 |
| UI-09 | 실제 라우트/role gate | 잘못된 역할 데이터 노출 없음, redirect 원래 계약 유지 | 감독 |
| UI-10 | 전체 Vitest/build | 기존17실패 명단 외 신규 실패0, 타입/빌드 새 오류0 | 감독 |

### 육안 캡처

- 모든 390/1440 경로 캡처를 before/after로 유지한다. 대표 불일치는 동일 역할 홈과 나란히 배치하고 제목/본문 시작선·버튼·카드의 차이를 표시한다.
- viewport 캡처만으로 내부 overflow 아래 영역이 검증되었다고 말하지 않는다. 내부 스크롤 끝·폼 오류·탭 활성·모달은 구현 단계에서 보조 캡처한다.
- PNG 육안 확인과 측정값을 함께 사용한다. AI·시안·fixture 표본을 실제 dev 데이터 검증으로 바꾸어 표기하지 않는다.

### 버튼 AA 대비

- normal/hover/focus에서 실제 foreground와 합성된 최종 background를 측정한다. 투명 배경은 조상 배경과 합성하며 gradient/image 위는 최저 대비 위치를 시각 확인한다.
- sRGB 선형화→상대휘도 `(Lmax+.05)/(Lmin+.05)`로 계산한다. 18pt(24px) 이상 또는 14pt(18.67px) bold 이상은 3:1, 그 외 4.5:1. 아이콘/필수 경계 3:1.
- 예: #5F0080/#FFF 주 CTA 조합은 독립 계산으로 기록하되, 그 한 쌍만으로 앱 전체 AA를 선언하지 않는다. 각 버튼 variant/상태를 표에 기록한다.
- focus 링이 잘리는 overflow, disabled 접근성 설명, 색만 다른 선택 상태를 검토한다.

## 구현 승인/완료 게이트

- [ ] spec '결정 필요' 최대3개 방향 확정 및 예외 목록 승인.
- [ ] 감사의 오류·분기 상태를 target/fixture에 반영, 실제 일반 화면 전체 정상/빈상태 측정 가능.
- [ ] worker 소유권 중복0·로그인 FIX 충돌0 확인.
- [ ] T1 토큰/컴포넌트/selector 계약 RED→GREEN 후 페이지 이관.
- [ ] UI-01~10 실행, 일반 화면 미승인 차이0, AA 미승인 실패0.
- [ ] 독립 검증자가 diff·재측정·PNG를 재검증.
- [ ] 이후 summary 작성. 이번 감사 턴에는 위 구현 완료 항목을 체크하지 않는다.
