# 상담사 시안 A — 목록·만들기·상세
담당 파일 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/host-a.html` (이 파일과 `shots/host-a/`, `fit/host-a-*.txt`, `tools/host-a-*.mjs` 만 쓴다). 담당 화면: **FH01, FH02(a~e), FH03, FH04**.

## 화면별 요구
- FH01: 열린 클래스가 상단 고정 카드로 유지(열림/진행 중 → 이어서 열기·시작·닫기). 캘린더와 목록 중복 제거, 좁은 열은 카드. 클래스 없음 빈 상태. 셸형.
- FH02: 마법사 5단계(a 유형·방식 / b LINK BAND·녹음·AI 분석 / c 일정 즉시·예약 시간 선택 / d 참여자 초대(검색·칩) / e 확인). 몰입형. 오프라인이면 주소 입력, 온라인이면 하울링 안내 한 줄, 1:1이면 최대 1명 고정. 단계마다 한 화면, 하단 주 버튼 항상 보임.
- FH03: 생성 완료 — 코드 대형, 링크 복사, QR 영역(자리표시), 주 CTA '클래스 열러 가기', 보조 상세·목록·템플릿 저장.
- FH04: 상세 — 상태별(준비·예정·열림·진행·완료·취소) 다음 할 일 카드(열기), 방식 칩, 코드, 참여자(이름 표시), 취소는 확인 시트(진행 중엔 숨김), 모바일 복제·삭제 접근.

## 공통 요구
- 기획.md의 케이스 축을 `?case=` 프리셋으로 구현(레이아웃은 자리 고정, 상태만 분기).
- 완료 후 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/fit/host-a-fit.txt`, `host-a-symmetry.txt`가 위반 0건. 서버는 종료.
