# 회원 클래스 진행 화면 구현 계획

Goal: 디자인 정본의 1화면 구성을 기존 데이터 계약 위에 이식한다.
Architecture: GuestMeditationPanel은 기존 훅을 유지하고 전용 CSS로 레이아웃을 제한한다.
metric-bar-chart는 25개 샘플 단위 평균 및 빈 구간을 표현한다. GuestAudioPanel은 선택적 compact 모드로 기존 사용처를 보호한다.
Spec: ./spec.md 및 ../../design/member-class-player/index.html

- [ ] 12구간 평균 테스트: 300개 입력의 구간 평균, 부분 입력 오른쪽 정렬, 빈값, 300개 초과 절단, 입력 불변성.
- [ ] metric-bar-chart.tsx 및 평균 함수 구현. 막대 표시 데이터는 25초마다 갱신, 첫 데이터는 즉시 표시.
- [ ] GuestMeditationPanel.tsx + member-class-player.css: 데스크탑 1.5:1 / 모바일 영상 180px 이상, 3×2 카드, 타이머, 상태 및 조작 배치.
- [ ] GuestAudioPanel compact 미니바·팝업, CounselorLiveTile 빈 상태 글로우. 기존 신호·채팅·몰입 유지.
- [ ] 빌드 및 전체 vitest, 실제 브라우저 두 뷰포트에서 overflow/터치 영역/카드 전환/팝업/몰입 검증.
- [ ] summary.md 결과 및 worker_done 보고.

검토 초점: 밴드 없는 상태, 25초 미만 부분 구간, 오디오 자동재생 차단, 모바일 채팅 겹침, 강당형 타이머 유지.
