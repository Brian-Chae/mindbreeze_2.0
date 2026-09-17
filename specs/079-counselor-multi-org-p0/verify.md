# SDD-079 Verify — 구현 전 QA 체크리스트

> Stage ③ — 구현 전 작성. 아래 시나리오는 pytest(신규 test_sdd079)로 검증한다.

## TS1. membership 테이블 + 백필

- [ ] TS1-1: 마이그레이션 후 `user_org_memberships` 존재, 제약 2종
      (UNIQUE(user_id,org_id) WHERE status!='left', UNIQUE(user_id) WHERE is_primary AND status='active')
- [ ] TS1-2: 백필 — org_id 보유 active counselor/org_admin → membership(active, is_primary=True, joined_at≈created_at)
- [ ] TS1-3: 백필 — pending 초대 계정 → membership(invited, invited_at/expires 이관)

## TS2. 초대 분기 (invite_counselor)

- [ ] TS2-1: 신규 이메일 → User(pending)+CounselorProfile+membership(invited)+초대 메일 (기존과 동일)
- [ ] TS2-2: 기존 active 상담사(타 기관 소속) 초대 → 201, 계정·프로필 추가 생성 없음,
      membership(invited) 생성, "소속 초대" 메일 발송
- [ ] TS2-3: 같은 기관에 이미 active 소속 상담사 재초대 → 409 "이미 이 기관에 소속(초대)된 상담사입니다"
- [ ] TS2-4: 같은 기관에 invited 상태 재초대 → 409 (동일 문구)
- [ ] TS2-5: 기존 이메일 role != counselor (client/org_admin) → 409 "상담사 계정이 아닌 이메일입니다"
- [ ] TS2-6: 응답에 token/invite_link 미노출

## TS3. 소속 초대 수락

- [ ] TS3-1: 소속 초대 토큰 수락 → membership active + joined_at 기록, 계정 상태/비밀번호 불변
- [ ] TS3-2: 토큰 재사용 → 401
- [ ] TS3-3: 소속 초대 토큰을 set-password 에 넣으면 401 (계정 탈취 차단)
- [ ] TS3-4: 무소속 상담사가 수락 → 해당 기관이 주 소속(User.org_id 미러 갱신)
- [ ] TS3-5: 이미 주 소속이 있는 상담사가 수락 → 주 소속 불변, 소속 2개

## TS4. 신규 초대 수락(set-password) 연동

- [ ] TS4-1: 신규 상담사 set-password 수락 → 계정 active + membership active(is_primary=True)

## TS5. 구성원 목록 membership 기반

- [ ] TS5-1: 목록에 [active 멤버 + invited(신규) + invited(소속 추가)] 모두 표시
- [ ] TS5-2: invited(소속 추가) 행 — status="pending", invite_type="org_membership"
- [ ] TS5-3: invited(신규) 행 — invite_type="new_account"
- [ ] TS5-4: 타 기관 화면에는 해당 기관 소속만 (격리)

## TS6. 소속 해제 · 재가입

- [ ] TS6-1: 소속 해제 → membership.status='left'+left_at (행 삭제 없음), User.org_id 미러 갱신
- [ ] TS6-2: left 후 같은 기관 재초대 → 새 membership(invited) 행 생성 가능 (409 아님)
- [ ] TS6-3: 다중 소속 상담사의 주 소속 해제 → 남은 active 소속이 주 소속으로 승격

## TS7. 재발송

- [ ] TS7-1: 신규 초대(pending 계정) 재발송 → set-password 링크
- [ ] TS7-2: 소속 추가 초대 재발송 → membership 링크
- [ ] TS7-3: active 소속 재발송 → 409

## TS8. 회귀

- [ ] 기존 pytest 전체 통과 (`cd backend && venv/bin/pytest`)
- [ ] `cd frontend && npm run build` 0 error
