# SDD-334 Verify (구현 전 체크리스트)

## 서버 판정
- [ ] 입장 후 89초·데이터 0건 → false / 91초 → true
- [ ] 이후 feature 1건 도착 → 즉시 false
- [ ] raw 청크만 있어도 false(측정 시작됨)
- [ ] `eeg_collection_consented=False`(밴드 미사용 명시) → 제외
- [ ] consented=None/True + 데이터 없음 → 대상
- [ ] 측정하다 끊김(feature 있음, stale) → measure_not_started=false, 기존 disconnected 유지
- [ ] 미입장(entered_at 없음)·대기열·회차 in_progress 아님 → false
- [ ] 입장이 회차 시작 전이면 started_at 기준으로 90초
- [ ] 응답에 기존 필드 모두 유지, REST/WS 스냅샷 동일 dict

## 화면
- [ ] "이상 M명"에 포함, 이상 필터에 나타남
- [ ] 카드 문구 "측정 시작 안 됨 · N분째" + 조치 안내, 점수·등급 없음
- [ ] 데이터 수신(last_eeg_at) 시 즉시 해제
- [ ] 미착용(off) 회원은 이상에 불포함(기존 규칙 유지)

## 배포 확인
- [ ] CI 통과, Deploy Dev success
- [ ] dev API live-metrics에 필드 존재, 가능하면 실제 회차로 true/false 재현
- [ ] 코치 화면 캡처 저장
