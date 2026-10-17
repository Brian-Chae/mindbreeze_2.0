# 회원 시안 B — 입장 준비 마법사·시작 대기·종료
담당 파일 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/member-b.html` (이 파일과 `shots/member-b/`, `fit/member-b-*.txt`, `tools/member-b-*.mjs` 만 쓴다). 담당 화면: **FM06a, FM06b, FM06c, FM06d, FM06e, FM07, FM08, FM09**.

## 화면별 요구
- FM06: 5개 화면이 하나의 마법사. 진행 점이 가운데, 하단 주 버튼. 케이스: 온라인/오프라인 × 그룹/1:1 × LINK BAND 3모드 × 회원/게스트(게스트는 이름 입력이 FM06a에 포함). 오프라인은 FM06d 단계가 없어 진행 점도 줄어든다. 사용 안 함 모드는 FM06c 단계가 없다.
- FM06b: 3축(집중·편안함·감정)을 한 화면에 한 축씩 5단계 라벨 선택(숫자 노출 최소) + 건너뛰기, 마지막에 상담사에게 전할 말(선택).
- FM06c: 미지원 브라우저·미연결·연결 중·연결됨(배터리, 접촉 양호)·접촉 불량·필수 모드(건너뛰기 없음).
- FM06d: 마이크 정상/권한 거부/장치 없음(칩 문구 구분)·카메라 켜짐/거부·스피커 테스트, 허용 방법 시트.
- FM07: 시작 예정 시각·준비 인원 표시(순위 아님), BGM(온라인만), 오프라인 변형, 준비 다시 확인하기.
- FM08: 정원 초과 대기열 안내. FM09: 종료 카드 + 시트 2종(리포트 받기 — 회원/게스트 OTP, 오늘 상태 남기기), 시트 내 중첩 스크롤 금지.

## 공통 요구
- 기획.md의 케이스 축을 `?case=` 프리셋으로 구현(레이아웃은 자리 고정, 상태만 분기).
- 완료 후 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/fit/member-b-fit.txt`, `member-b-symmetry.txt`가 위반 0건. 서버는 종료.
