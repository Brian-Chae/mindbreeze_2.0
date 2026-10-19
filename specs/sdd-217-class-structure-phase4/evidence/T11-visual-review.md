# T11 실제 시각 검증

모든 화면의 이름·기관·연락처·리포트는 합성 데이터다. Chrome headless 실제 렌더를 촬영하고 view_image로 확인했다. 화면의 일시 자격 output은 숨겼다. DOM 수치만으로 시각 통과를 판정하지 않았다.

네 viewport 각각에서 회원 이탈/보강 완료, 수료·중간합류 전, 호스트 멤버 운영, 공개 비회원 가입을 확인했다. 각 폭에서 카드·입력·배지·버튼의 가로 넘침과 내용 잘림이 없었다. 회원·호스트는 앱 본문 내부가 세로 스크롤되므로 아래 회차와 폼을 추가로 스크롤해 촬영했다. 세로 스크롤로 화면 밖인 내용은 클리핑 실패로 간주하지 않는다.

본문 main을 측정한 T11-layout.json은 16개 모두 scrollWidth=viewportWidth, 가로 경계를 벗어난 주요 요소0이다. 초기 전체 문서 검사에서 모바일 닫힌 sidebar의 로그아웃 버튼1개가 잡혔으나 의도된 off-canvas 영역이었고 화면 시각 검증에서도 노출되지 않았다. 본문 범위로 계측을 한정했다.

## 390x844

- [member-left](T11-member-left-390x844.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-completed-before](T11-member-completed-before-390x844.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [host-members](T11-host-members-390x844.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [guest-public](T11-guest-public-390x844.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-left 아래 스크롤](T11-member-left-lower-390x844.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [member-completed-before 아래 스크롤](T11-member-completed-before-lower-390x844.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [host-members 아래 스크롤](T11-host-members-lower-390x844.png) — 보강/취소 배지 또는 하단 운영 폼 확인.

## 834x1194

- [member-left](T11-member-left-834x1194.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-completed-before](T11-member-completed-before-834x1194.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [host-members](T11-host-members-834x1194.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [guest-public](T11-guest-public-834x1194.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-left 아래 스크롤](T11-member-left-lower-834x1194.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [member-completed-before 아래 스크롤](T11-member-completed-before-lower-834x1194.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [host-members 아래 스크롤](T11-host-members-lower-834x1194.png) — 보강/취소 배지 또는 하단 운영 폼 확인.

## 1194x834

- [member-left](T11-member-left-1194x834.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-completed-before](T11-member-completed-before-1194x834.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [host-members](T11-host-members-1194x834.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [guest-public](T11-guest-public-1194x834.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-left 아래 스크롤](T11-member-left-lower-1194x834.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [member-completed-before 아래 스크롤](T11-member-completed-before-lower-1194x834.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [host-members 아래 스크롤](T11-host-members-lower-1194x834.png) — 보강/취소 배지 또는 하단 운영 폼 확인.

## 1280x720

- [member-left](T11-member-left-1280x720.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-completed-before](T11-member-completed-before-1280x720.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [host-members](T11-host-members-1280x720.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [guest-public](T11-guest-public-1280x720.png) — 카드·한글 줄바꿈·배지·입력 영역 확인.
- [member-left 아래 스크롤](T11-member-left-lower-1280x720.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [member-completed-before 아래 스크롤](T11-member-completed-before-lower-1280x720.png) — 보강/취소 배지 또는 하단 운영 폼 확인.
- [host-members 아래 스크롤](T11-host-members-lower-1280x720.png) — 보강/취소 배지 또는 하단 운영 폼 확인.

## 진행 화면 실제 복원

[호스트 reload](T11-host-restored.png): 체크인 완료인 실제 입장자1명과 미입장자1명, 접속1/2·체크인1/2·밴드 연결0이 서로 일치한다. 초기 시각 점검에서 발견한 집계 불일치 수정 후 최신 실제 screenshot을 다시 확인했다. [초대만 된 로비](T11-host-before-checkin.png)는 초대2/대기0·미입장2로 표시한다. [즉시 클래스 완료](T11-instant-completed.png)는1/1·완료를 표시한다. [guest 이탈 후 본인 리포트](T11-guest-left-read.png)는 개인 읽기 범위의 합성 리포트다.

이 검증은 실제 카메라·휴대폰 하드웨어·외부 LiveKit 전달이나 접근성 전체 감사의 통과를 뜻하지 않는다.

## 독립 리뷰 fix1 active 활성 조작 영역

최초 촬영의 active 상태 누락을 별도 실제 API/PG active 클래스에서 보완했다. class와 member가 active인 상태에서 사전 결석·보강 신청·동의 저장 버튼 및 입력의 enabled를 확인하고, 실제 저장 이후 보강 예약 배지/취소 버튼도 확인했다. 아래20장 모두 view_image로 직접 열어 카드·한글 줄바꿈·활성 버튼·입력·배지를 확인했다. 본문 가로 넘침/클리핑0. 세로 스크롤 아래 영역은 해당 조작이 보이도록 이동해 촬영했으며 다른 영역이 viewport 밖인 것은 정상 스크롤이다. 이름·기관·정보는 합성이고 output 자격은 숨겼다.

### active 390x844

- [참여 중 배지·나가기](T11-active-top-390x844.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [미래 회차 사전 결석](T11-active-attendance-390x844.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [원/대상 선택·보강 신청](T11-active-makeup-390x844.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [선택 동의 편집·저장](T11-active-consents-390x844.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [보강 예약 배지·취소 버튼](T11-active-makeup-reserved-390x844.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.

### active 834x1194

- [참여 중 배지·나가기](T11-active-top-834x1194.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [미래 회차 사전 결석](T11-active-attendance-834x1194.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [원/대상 선택·보강 신청](T11-active-makeup-834x1194.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [선택 동의 편집·저장](T11-active-consents-834x1194.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [보강 예약 배지·취소 버튼](T11-active-makeup-reserved-834x1194.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.

### active 1194x834

- [참여 중 배지·나가기](T11-active-top-1194x834.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [미래 회차 사전 결석](T11-active-attendance-1194x834.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [원/대상 선택·보강 신청](T11-active-makeup-1194x834.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [선택 동의 편집·저장](T11-active-consents-1194x834.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [보강 예약 배지·취소 버튼](T11-active-makeup-reserved-1194x834.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.

### active 1280x720

- [참여 중 배지·나가기](T11-active-top-1280x720.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [미래 회차 사전 결석](T11-active-attendance-1280x720.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [원/대상 선택·보강 신청](T11-active-makeup-1280x720.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [선택 동의 편집·저장](T11-active-consents-1280x720.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.
- [보강 예약 배지·취소 버튼](T11-active-makeup-reserved-1280x720.png) — 활성 조작 영역 표시·줄바꿈·경계 확인.

추가 실행: `node frontend/e2e/sdd217-class-membership.mjs --active-layout-only`. 로그인4 포함8 helper 단계 PASS/0 실패, 동의200·사전결석200·복귀200·보강201·active 유지. 기존 전체23여정에 합산하지 않는다. 제품 변경·단위/BE 전체 재실행 없음.
