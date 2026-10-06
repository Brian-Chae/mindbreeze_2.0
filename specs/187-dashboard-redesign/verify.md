# [SDD-187] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 회원 다음 세션 히어로
1. 진행중/오픈/ready 세션이 있으면 그 세션을 히어로로 표시
2. 없으면 가장 임박한 `scheduled_at` 예약 세션 표시
- **Expected:** 히어로에 제목·날짜·상담사·참여코드·입장하기 버튼 노출, 카운트다운 정상

### TS2: 회원 리포트 상담사용 노출 제거
1. 리포트 목록에 `type=counselor`와 `type=client` 혼재
- **Expected:** 홈 "내 리포트"에 `type=client`만 표시, 상담사용 미노출

### TS3: 초대 수락 보존
1. 세션 초대 알림 존재 시 "초대된 클래스" 섹션 표시
2. 수락 시 `markRead` + 세션 이동
- **Expected:** 기존 `handleConfirmInvite` 동작 유지

### TS4: 상담사 지금 할 일
1. 진행중/오픈 클래스 있으면 최상단 카드(입장 CTA·코드 복사)
2. 승인 대기 리포트 있으면 배너(리포트 검토)
- **Expected:** `data.classes`에서 status=in_progress/open 추출, report_count>0 & 미승인 추출

### TS5: 반응형 간격
1. 390px 모바일에서 컴포넌트 간 간격 24~32px
2. 히어로 제목 한 줄(줄바꿈 없음)
3. 480~767px에서 콘텐츠 max-width 560px 중앙 정렬
- **Expected:** Chrome headless 스크린샷 + vision 검증 통과

### TS6: 상담사 코드 접이식
1. 접힌 상태: 코드 한 줄 요약
2. 펼침 시 코드 + 복사 버튼
- **Expected:** 클릭 토글 동작, 복사 기능 유지

## Edge Cases
- [ ] 세션 0건: 히어로 대신 빈 상태 안내
- [ ] 리포트 0건: "아직 리포트가 없어요" 빈 상태
- [ ] 상담사 0명(회원): 담당 상담사 섹션 숨김
- [ ] `scheduled_at` null(즉시 세션): "즉시 입장 가능" 표시
- [ ] `access_code` null: 코드 복사 숨김

## Security Review
- [ ] 참여코드/상담사 코드 복사는 `navigator.clipboard` — 토큰·비밀번호 미노출
- [ ] 회원 리포트 `type=client` 필터로 타인(상담사용) 데이터 미노출
