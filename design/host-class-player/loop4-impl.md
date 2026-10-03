# 루프4 구현 — 최종 폴리시 (Claude 리뷰 잔여 1~4)

`design/host-class-player/index.html` 을 아래대로 수정하라. (구현 금지, 목업 HTML만)

## 1. 보더·라운드 토큰 통일
- 컨테이너 라운드 1종 통일(그룹 14px ↔ 카드 12px 불일치 해소, 동일 워크스페이스 내 통일)
- 보더 알파를 2단계 토큰화: 컨테이너(예 #ffffff1A) / 구분선(예 #ffffff0D)로 정리

## 2. 희소 참가자 상태
- 참가자 1명일 때 카드가 가로 전체로 안 늘어나게(열 상한 또는 max-content)
- 참가자 0명 → 로스터 empty-state 표시
- 유효 표본 0명 → "표본 없음" 상태 정의(그룹 흐름 가드)

## 3. 죽은 CSS/데이터 제거 (정본 명료성)
- 미사용 제거: `.spark*`(그룹 스파크), `.mini-chart/.waiting-line/.wait-dot`, `.detail-legend*`, `.band-dot.off/.lost`, `metrics[].heading/.name`(미참조)

## 4. 접근성
- `#detail-panel`에 `aria-modal="true"` 추가
- `is-zero` 숫자 대비 상향(#6b5a78 → #8a7897)

## 제약 (유지)
- 2칼럼 레이아웃, 조용한 신호 카드, 상세 시트(링+스파크라인), chip 단일 선택+모두, 10초 순환 유지
- 다크테마 #12081C·보라 #5F0080·크림 #F7F4F0
- 데스크탑 1280×720 / 모바일 390×844
