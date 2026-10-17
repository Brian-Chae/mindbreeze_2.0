# 회원 시안 A — 홈·목록·상세·입장
담당 파일 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/member-a.html` (이 파일과 `shots/member-a/`, `fit/member-a-*.txt`, `tools/member-a-*.mjs` 만 쓴다). 담당 화면: **FM01, FM02, FM03, FM04, FM05, FM10(회원 쪽 취소됨·오류·네트워크 끊김)**.

## 화면별 요구
- FM01: 상태 4종(예정 D-day / 곧 열림 / 입장 가능 / 진행 중) + 클래스 없음 빈 상태. 셸형(`sh-*`), 히어로는 자연 사진 위 진행 화면 언어. 모바일은 하단 탭바 포함 한 화면.
- FM02: 목록(입장 가능 최상단, 내부 스크롤만 허용) + 신청 바텀 시트(탭바에 가려지지 않게). 초대 클래스 카드.
- FM03: 4상태(예정·입장 가능·완료·취소) × 방식(온라인/오프라인, 1:1/그룹, LINK BAND 사용 안 함/선택/필수).
- FM04: 코드 입력(빈/입력 중/오류 3종: 코드 없음·종료/취소·아직 열리지 않음). 로고 + 6칸 + 로그인/게스트 진입.
- FM05: 로그인 회원(확인 카드)·게스트(이름 + 선택 정보 접기)·열림 전 대기·열림 후. 클래스 요약(시작 시각·방식·진행자).
- FM10: 취소됨 / 오류 / 네트워크 끊김 전체 화면 템플릿 1종(정중앙).

## 공통 요구
- 기획.md의 케이스 축을 `?case=` 프리셋으로 구현(레이아웃은 자리 고정, 상태만 분기).
- 완료 후 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/fit/member-a-fit.txt`, `member-a-symmetry.txt`가 위반 0건. 서버는 종료.
