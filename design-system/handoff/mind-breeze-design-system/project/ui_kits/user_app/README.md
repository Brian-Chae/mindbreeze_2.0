# 참여자 앱 (User App) UI Kit

명상 참여자·내담자가 사용하는 모바일 앱 UI 키트. 지도사용 Operator App과 짝을 이룹니다.

## 화면
- **HomeScreen** — 오늘의 추천 명상 hero + 이번 주 휴식도 / 연속 명상 stat 카드 + 다음 클래스 chip + 최근 리포트 목록
- **SessionScreen** — 진행 중인 명상 화면. 보라 라디얼 그라데이션 위에 호흡 원(들숨/날숨 펄스 애니메이션), 실시간 휴식도 EEG 파형, 4단계 진행 컨트롤
- **ReportScreen** — 세션 후 리포트. 큰 휴식도 score ring, 이완/집중/균형 metric bar, 회차 흐름 area chart, 지도사 코멘트 카드
- **ClassScreen** — 예정된 클래스 목록. featured 8주 프로그램 카드 + 날짜 chip 리스트 (오프라인/온라인 태그)
- **ProfileScreen** — 프로필 카드 (8주 진척도 dot 시각화) + quick stats + 설정 리스트 (LINK BAND 연결 상태 포함)

## 컴포넌트
- **UserShell** — IOSDevice 안에 TopBar + content + TabBar 배치
- **TopBar** — eyebrow + title, 좌·우 슬롯
- **TabBar** — 4탭 (오늘 · 클래스 · 리포트 · 프로필), 활성 시 보라 stroke 굵기 + 라벨 강조
- **ScoreRing**, **MetricBar** — 리포트 시각화

## 디자인 토큰
- 배경: `--mb-purple-cream` (#F5EDFC) — 참여자 앱 기본 surface
- 카드: 흰색 22px 라운드 + `--mb-shadow-card`
- 세션 화면: `radial-gradient(120% 80% at 50% 35%, #C297E0, #5F0080, #2B0042)` — 명상에 몰입하는 다크 보라 무드

## 파일
| 파일 | 설명 |
|---|---|
| `index.html` | iOS 프레임 + 5개 화면 토글 |
| `UserShell.jsx` | 공통 chrome (TopBar / TabBar) |
| `HomeScreen.jsx` | 오늘 탭 |
| `SessionScreen.jsx` | 세션 진행 |
| `ReportScreen.jsx` | 리포트 상세 |
| `ClassScreen.jsx` | 예정 클래스 |
| `ProfileScreen.jsx` | 프로필 + 설정 |
| `ios-frame.jsx` | iOS 디바이스 프레임 (스타터) |
