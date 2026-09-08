# SDD-029 — 1.0 디자인 패리티 구현 명세 (P0)

> 기획: specs/029-1.0-design-parity/{01~05}.md · Orca orchestration · Brian 결정 4건 반영

## Brian 결정 (확정)

1. **리포트 = 메일 발송** — 게스트 완료 화면의 전화 신청 대신 이메일 수집 → 리포트 메일 발송 (2.0 `tasks/email.py` 재사용)
2. **배터리 임계 통일** — `<=25%` (25% 이하면 "배터리 부족" 경고). 1.0 카드 `<25`/셀 `<=25` 불일치를 `<=25`로 통일
3. **종료 버튼** — 시작=진보라(#5F0080 primary), 종료=연보라(#D2AEFC secondary) — 1.0 기준
4. **초대형 숫자 반응형** — `clamp(64px, 10vw, 130px)` (두뇌휴식도/타이머), "AI 분석중" `clamp(40px, 6vw, 70px)`

## P0 범위 (몰입 핵심 + 호스트)

### 1. 게스트 명상 화면 (class-join-page meditation + GuestMeditationPanel)
- **검정 풀블리드** (#000) — 보라 그라데이션 카드 제거
- **FadingImageBackground** — `frontend/public/images/background1~10.webp` (이미 최적화 완료), 20초 간격 + 1초 CSS `transition-opacity` 교차 페이드, `background-size: cover`
- **초대형 두뇌휴식도** — `clamp(64px,10vw,130px)` 흰색, `%` 접미사
- **"AI 분석중" BlinkingText** — `clamp(40px,6vw,70px)`, CSS keyframes 깜빡임 (LeadOff 해소 후 15초)
- **BrainChart 패리티** — 회색(#D9D9D9CC/#D9D9D933) 둥근 막대 바차트 (bar 14px, gap 12px, threshold 40)
- **Timer 초대형** — 진행시간 clamp

### 2. 호스트 세션 화면 (SessionLivePage)
- **흰 배경** + 세션코드 배너(#F2F3F8, radius 12) + "수업을 시작했어요/아직 시작 안 됨" + Timer
- **DashboardBox 4종** — 수평 16px 카드(제목 왼쪽 + `N명` 오른쪽), 경고 1명 이상이면 카드 전체 빨강(#F2212133/#F22121B2), 배터리 `<=25`
- **평평한 테이블** — 8컬럼(자리/이름/접촉/기기/배터리/평균·현재두뇌휴식도/업로드), 헤더 #F2F3F8 + 교차행, 빨강 행 강조(접촉불량/연결실패/무응답)
- **버튼** — 시작=진보라, 종료=연보라 (disabled #DDDEE7/#A2A3AD)

## 데이터 계약 (변경 없음)
폴링/WS/BLE/상태 머신은 SDD-021~026 유지. 본 SDD는 **표현층 패리티**만.

## 수락 기준
- [ ] 명상 화면: 검정 + 자연 이미지 페이드(20s/1s) + 130px 두뇌휴식도 + BlinkingText + 바차트
- [ ] 호스트: 흰 배경 + DashboardBox 4종(수평 카드, 빨강 경고) + 평평한 8컬럼 테이블
- [ ] 버튼: 시작 진보라 / 종료 연보라
- [ ] 배터리 `<=25` 경고 통일
- [ ] 초대형 숫자 clamp 반응형 (모바일 오버플로 없음)
- [ ] 프론트 tsc/build 통과
