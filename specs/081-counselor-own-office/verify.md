# SDD-081 — Verify (Stage ③, 구현 전 QA 체크리스트)

## 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| TS1 | 기관 초대(신규 상담사) 수락(set-password) | 개인 상담소 자동 개설 — kind=individual, owner_user_id=상담사, verified=True, org_code 없음. membership active. 주 소속은 초대한 기관(개인 상담소는 비주) |
| TS2 | 개인 상담사 신청 승인 → 초대 수락 | SDD-073 이 만든 기존 개인 기관 재사용 — owner 기준 기관 1개만 존재(중복 생성 금지), membership active + is_primary |
| TS3 | 기관 해제(org_admin, DELETE counselors) 후 남은 active 소속 없음 | 개인 상담소 복귀 — membership active + is_primary, User.org_id=개인 상담소. `org_removed` 알림 생성 + 안내 메일 큐 적재 |
| TS4 | 다중 소속 상담사가 한 기관에서만 해제 | 남은 기관이 주 소속 승격(SDD-079) — 개인 상담소 복귀·알림·메일 없음 |
| TS5 | 플랫폼 관리자 해제(change_counselor role=None) | TS3 과 동일 복귀 동작 |
| TS6 | 개인 상담소 존재 상태에서 ensure 재호출 | 기관 중복 생성 없음 (owner 기준 1개 유지) |
| TS7 | `/org/search`, `/admin/orgs` | kind=individual 기관 미노출 |
| TS8 | 상담사 본인 대시보드 | org_kind='individual' 반환 → FE "내 개인 상담소" 라벨 |
| TS9 | org_admin 초대 수락 | 개인 상담소 생성되지 않음 (상담사 전용) |
| TS10 | 팝업 1회 노출 | `org_removed` 미읽음 알림 → 팝업, 확인(mark read) 후 재조회 시 미노출 |

## 회귀 확인
- SDD-079 membership 테스트 전체 통과 (기존 primary 승격·초대 분기 불변)
- SDD-073 개인 상담사 신청 테스트 통과
- SDD-076/077 기관 상담사 관리 테스트 통과 (해제 409 가드 불변)
- `cd backend && venv/bin/pytest` 전체 통과
- `cd frontend && npm run build` 0 error

## 보안·정책 체크
- 개인 상담소에 org_code 미발급 — 기관 코드 가입 경로 우회 불가
- 개인 상담소 소유자는 change_counselor 로 해제 불가 (기존 409 가드 유지)
- counselor_code 계정당 1개 유지 (개인 상담소 생성이 프로필/코드를 건드리지 않음)
- 알림 mark read 는 본인만 가능 (기존 notifications API 권한)
