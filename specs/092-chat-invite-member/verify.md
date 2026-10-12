# [SDD-092] — Verification (Pre-Implementation)

## Test Scenarios

### 초대 대상·권한
- TS1: group host(상담사)가 같은 기관 상담사 초대 → 200
- TS2: 기관 관리자(org_admin, host와 같은 기관)가 초대 → 200
- TS3: 다른 기관 상담사 초대 → 403
- TS4: 내담자가 초대 시도 → 403
- TS5: `left`/`invited` 멤버십·`suspended` 계정 상담사 → 403
- TS6: 내담자 초대 기존 경로(Link/공유기관) 하위 호환 → 200

### 기존 방 추가 vs 새 방
- TS7: 기존 방에 상담사 추가 → 대화 이력 유지, 명단에 role 노출
- TS8: fork(새 방) → 기존 참여자 승계 + 새 참여자, 대화 0건, 기존 방 유지
- TS9: direct 방 fork → 새 group 방(host+상대+새참여자)
- TS10: direct 방 "기존 방에 추가" → 403 (fork만 허용)
- TS11: 새 방 이름 미지정 → 서버 기본 이름

### 후보 조회
- TS12: 공유 기관 active 상담사만 후보로 반환 (본인·타기관 제외)

## 수락 기준
- Q1: host/기관관리자 초대 + 내담자 하위 호환, 권한 위반 전부 403
- Q2: fork 시 대화 이력 미복사 + 기존 방 유지
- Q3: 기존 테스트(test_chat.py 29개) 무회귀
