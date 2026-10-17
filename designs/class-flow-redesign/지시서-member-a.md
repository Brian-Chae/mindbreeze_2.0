# 회원 시안 A — 홈·목록·상세·코드 입장·입장 확인 (R4/R5 정합)
담당 파일 `designs/class-flow-redesign/member-a.html` (이 파일과 `shots/member-a/`, `fit/member-a-*.txt`, `tools/member-a-*.mjs` 만 쓴다). 담당 화면: **FM01, FM02, FM03, FM04(신규), FM04b(신규), FM05, FM10**. 문구 정본 = `specs/sdd-209-class-flow-redesign/verify.md` §3.1·§3.2.

## 케이스 (합계 36)
- FM01(셸형): upcoming · soon · open · live · empty — 홈 목록 아래 보조 텍스트 버튼 `코드로 입장하기`(→ FM04:default). 참여코드 칩·복사 0.
- FM02(셸형): list · invited · apply — `invited` 는 상담사 초대 표시만(입장 자격 제한 문구 0).
- FM03(셸형): scheduled · scheduled-offline · open · open-offline · open-1on1 · done · cancelled — 밴드 필수 모드도 `LINK BAND (권장)` · `LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요`.
- FM04 코드 입력(몰입형): default · filled · leading-zero · error · throttled · member — 숫자 4칸(inputMode numeric)·`코드 확인`. 이름·성별·생년월일·이메일 입력 0, OTP·로그인 요구 0. 오류 문구는 `코드를 확인해 주세요` 하나(구분 없음).
- FM04b 개인정보 입력(몰입형): default · filled · error · mismatch · member — `정보를 입력해 주세요`·클래스 요약·이름/성별/생년월일/이메일/이메일 확인·`입장하기`. member 는 계정 값 읽기 전용(이메일 재입력 생략).
- FM05 입장 확인(몰입형): member · guest-name · member-wait · member-offline — `{이름}님` 확인 카드, 입력 요소 0.
- FM10(몰입형): cancelled · closed · notyet · error · offline · entry-expired — entry-expired → `코드 입력하기`(FM04).

## 흐름 링크 (data-go)
FM01/FM02/FM03 `입장하기` → FM05 · FM01 `코드로 입장하기` → FM04:default · FM04 `코드 확인` → FM04b:default(member → FM04b:member) · FM04b `입장하기` → FM05:guest-name(member → FM05:member) · FM05 `입장하기` = 준비 마법사(member-b) 진입이라 시안 밖 · FM10 entry-expired → FM04:default.

## 레이아웃 메모
- FM04b 는 `--col-w 640`, 640px 이상 2열 / 모바일 1열로 4개 뷰포트 모두 페이지 스크롤 0.
- 측정: `node tools/member-a-run.mjs final` (서버 5301, 서빙 루트 `designs/`). 결과 `fit/member-a-fit.txt`, `fit/member-a-symmetry.txt` 위반 0건.
