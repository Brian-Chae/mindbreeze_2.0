# 회원 시안 B — 입장 준비 마법사·시작 대기·종료 (R4/R5 정합)
담당 파일 `designs/class-flow-redesign/member-b.html` (이 파일과 `shots/member-b/`, `fit/member-b-*.txt`, `tools/member-b-*.mjs` 만 쓴다). 담당 화면: **FM06a, FM06b, FM06c, FM06d, FM06e, FM07, FM08, FM09**. 문구 정본 = `specs/sdd-209-class-flow-redesign/verify.md` §3.3, 케이스 키 정본도 같은 표(합계 70).

## 화면별 요구
- FM06 마법사: 진행 점이 가운데, 하단 주 버튼 1개. 케이스 키 `{on|off}-{group|solo}-{none|opt|req}-member[-상태]`. 오프라인은 기기 단계가 없고, 사용 안 함(none)은 LINK BAND 단계가 없다.
- FM06a `시작 전에 확인해 주세요`(9): 고지(녹음과 AI 기록 · 뇌파 측정 · 영상 · `기록 원본(뇌파·음성·영상)은 {N}일이 지나면 삭제돼요`) + 리포트 반영 선택(`반영하지 않아요` 기본 / `반영해요`) + 연구 동의 별도 블록(체크 `동의해요` 기본 해제). 주 버튼 `확인하고 계속하기` 는 항상 활성. 상태 키: `empty`(아직 고르지 않음, 계속하기 가능) · `included` · `research-agree` · `research-fail`(저장 실패 안내, 미동의로 진행). 4뷰포트 페이지 스크롤 0 이 되도록 카드를 압축하고 가로형은 2열.
- FM06b: 3축 5단계 라벨 선택 + 전할 말(선택), `-started` 시트.
- FM06c(15): 선택(opt)/권장(req) 모두 `LINK BAND 없이 계속하기` 제공, req 부제 `LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요`·`권장` 칩, 접촉 불량 시 `접촉을 확인해 주세요`(차단 없음), unsupported 는 `LINK BAND 없이 계속하기` 가 주 버튼(링크 복사 강제 없음).
- FM06d: 마이크 정상/권한 거부/장치 없음·카메라 켜짐/거부·스피커·허용 방법 시트.
- FM06e: 요약 행에 `리포트 반영하지 않아요`/`반영해요`, `연구 목적 활용에 동의하지 않았어요`/`동의했어요`, 밴드 미연결은 `LINK BAND 없이 참가해요`.
- FM07: 시작 예정 시각, `{N}명 중 {M}명이 준비를 마쳤어요`(원천은 AD2), BGM(온라인만), 오프라인 변형, 칩 `LINK BAND 권장`.
- FM08(4): `대기 취소`, `자리가 나면 알림으로 알려 드려요.`, 순번·순위 표현 없음. `cancel-sheet` = `대기를 취소할까요?` 확인 시트(`대기 취소` 파괴 동작 / `계속 대기하기`), 취소 후 FM04(`member-a.html?screen=FM04&case=default`)로 이동.
- FM09(9): 종료 카드 + 시트 2종. 리포트 받기는 회원 1탭(마스킹 이메일, 입력 칸·인증 없음). `excluded` = 리포트 제외 안내(신청 버튼 없음), `guest-report` = 비회원 마스킹 메일 자동 발송 안내.

## 공통 요구
- `window.__REG`(`[{id, cases}]`)·`window.__cases` 계약 유지, `?index=1` 인덱스의 가정 열은 R4/R5 정책 근거(AD 번호)로 기술.
- 완료 후 `fit/member-b-fit.txt`, `fit/member-b-symmetry.txt` 위반 0건. 서버는 종료.
