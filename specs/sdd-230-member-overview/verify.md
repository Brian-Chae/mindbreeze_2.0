# SDD-230 — Verify (Stage ③, 구현 전 작성)

| ID | 시나리오 | 기대 | 확인 방법 |
|---|---|---|---|
| V1 | 타 상담사·비연결(ended 포함) 회원의 상세/activity/reports/reveal | 403 | pytest |
| V2 | 목록은 내 active 연결 회원만. 검색(q)·class_id·active_within_days 서버 필터가 total 과 일치 | total=필터 결과 수 | pytest |
| V3 | 타 참여자 데이터 미노출: 같은 세션의 다른 참여자 체크인·리포트·측정이 응답에 없음 | 없음 | pytest |
| V4 | 내가 접근 못 하는 세션(타 상담사 호스트)의 회원 활동은 활동·최근활동·필터·건수에 미포함 | 미포함 | pytest |
| V5 | AI 비공개(ai_features_enabled=False)면 ai_checkin 이벤트 없음, `ai_included=false`, 최근 활동에도 불포함 | 제외 | pytest |
| V6 | 예정 세션·리포트 생성은 활동 아님. 출석 absent 는 세션 활동 아님 | 제외 | pytest |
| V7 | `last_session_at` 가 실제 마지막 세션 시각(더 이상 None 고정 아님), 활동 없으면 null | 일치 | pytest |
| V8 | 목록·상세 기본 응답에 전화 원문·생년월일 없음. `010-****-1234` 형식 마스킹. reveal 만 원문, 비연결 403 | 마스킹 | pytest |
| V9 | 만 나이 KST 경계(생일 전날/당일), 미입력 null | 정확 | pytest(순수 함수) |
| V10 | activity cursor 페이지네이션: 중복·누락 없음, 기간(days)·types 필터 교집합 | 정확 | pytest |
| V11 | reports: 해당 회원 participant 행 리포트만, 상태 라벨 구분(승인/검토 중/생성 중/실패) | 구분 | pytest |
| V12 | 변화: 승인 리포트만, 지표 delta 와 방향 서사, EEG 없음/표본부족 → 수치 없이 "비교 자료 부족"/"미측정". 종합점수·평균·개선률 필드 없음 | 점수 없음 | pytest + 응답 키 검사 |
| V13 | 응답 어디에도 온라인·최근 접속 필드 없음 | 없음 | pytest(키 검사) |
| V14 | FE 목록: 최초 표, 카드 전환 시 검색·필터·그룹 유지, 초기화·빈 결과·오류 재시도 | 동작 | vitest + 스크린샷 |
| V15 | FE 그룹핑: 복수 클래스 회원은 각 그룹에 표시, 총 회원 수는 고유 ID, '미소속' 그룹 | 정확 | vitest(순수 함수) |
| V16 | FE 상세: 마스킹 기본, 열람 버튼 후 원문 표시, AI 비공개면 안부 패널 마운트 안 함 | 동작 | vitest/스크린샷 |
| V17 | 점수·종합점수·순위 문구/숫자 미표시, 접속 열 없음 | 없음 | vitest 텍스트 검사 |
| V18 | 레이아웃 390/1194/1440: 페이지 가로 넘침 0, 표 내부 스크롤, 이름 열 고정, 터치 44px | 0 | Chrome headless 측정 + 스크린샷 |
| V19 | 접근성: 이름은 링크, 토글 aria-pressed, 로딩·오류·빈 상태 | 존재 | vitest |
| V20 | 기존 회귀: test_client.py, test_mb2_relations_consistency.py, agent_checkin 테스트, tsc | 통과 | pytest/tsc |

## 1-2단계 — 기관관리자 범위 (구현 전 작성)

| ID | 시나리오 | 기대 | 확인 |
|---|---|---|---|
| A1 | 기관 클래스 active 멤버/기관 귀속 active 상담관계 회원이 기관관리자 목록·상세·activity·reports·reveal 에 접근 | 200, total 포함 | pytest |
| A2 | 타 기관 관리자 → 우리 기관 회원 상세/activity/reports/reveal | 403, 목록 미포함 | pytest |
| A3 | 개인상담소(kind=individual) 귀속 클래스·상담관계 회원, 귀속 불명(known=False), 링크만 있는 회원 | 기관관리자에게 미노출(403) | pytest |
| A4 | 다중 기관 관리자: 두 기관 회원 모두 노출, 관리자 권한 없는 3번째 기관 회원은 미노출. 한 기관 membership 이 left/비활성이면 그 기관 회원 미노출 | 정확 | pytest |
| A5 | 상담사(role=counselor) 범위 불변: 같은 기관 회원이라도 본인 active 연결 아니면 403, 목록은 연결 회원만 | 불변 | pytest(기존 V1/V2 + 신규) |
| A6 | 기관관리자 상세 memo 는 null(타 상담사 메모 비노출), 메모 저장 403. 본인 연결 회원이면 본인 메모 | 정책대로 | pytest |
| A7 | 기관관리자 activity/reports: 명상 클래스 세션 활동만, 상담 세션·상담사용 리포트·AI 안부 제외, 다른 참여자 행 미노출 | 제외 | pytest |
| A8 | 목록 `counselors`(관리 기관 소속 담당 상담사)·`counselor_id` 필터가 total 과 일치. 상담사 호출엔 필드 비어 있음 | 일치 | pytest |
| A9 | contact-reveal: 기관 회원 허용, 비회원 403, 감사 로그에 원문 없음 | 정책대로 | pytest |
| A10 | FE: 관리자 목록에 담당 상담사 열·필터 노출, 상담사엔 미노출. 상세 관리자(비연결)는 메모 영역 숨김. 접속·점수 문구 없음 | 동작 | vitest |
| A11 | 회귀: test_sdd230_member_overview, test_client, test_mb2_relations_consistency, tsc, 관련 vitest | 통과 | pytest/tsc/vitest |

## 1-3단계 — 기관 소속 상담사 연결 회원 + 회원/비회원 (구현 전 작성)

| ID | 시나리오 | 기대 | 확인 |
|---|---|---|---|
| L1 | 기관 소속(active) 상담사의 active 링크 회원(클래스·기관 상담관계 없음) → 기관관리자 목록·상세·activity·reports·reveal | 200, 목록 포함, `member_type=non_member` | pytest |
| L2 | 비소속 상담사 / membership left·invited / 계정 비활성 상담사 / 종료(ended) 링크 / 개인상담소만 소속 상담사의 연결 회원 | 목록 미포함, 상세 등 403 | pytest |
| L3 | 타 기관 관리자 → L1 회원 | 403, 목록 미포함 | pytest |
| L4 | 기관 클래스 멤버·기관 귀속 상담관계 회원은 `member`, 같은 회원이 상담사 링크도 있으면 `member`(중복 없이 1행) | 라벨 정확 | pytest |
| L5 | `member_type` 필터 member/non_member/전체가 total·행과 일치. 상담사 호출은 `member_type=null`, 필터 무시 | 일치 | pytest |
| L6 | 비회원도 상담 세션 활동·상담사용 리포트·AI 안부·비공개 메모 비노출. 상담사 개인상담소 회원 섞여도 포함(결정 ①) | 제외 유지 | pytest |
| L7 | 상담사 본인 범위 불변(같은 기관 다른 상담사 회원 403), 다중 기관 합집합 | 불변 | pytest |
| L8 | FE: 관리자 목록 배지 회원/비회원·필터·설명 노출, 상담사엔 없음. 상세 헤더 배지. 점수·접속 문구 없음 | 동작 | vitest |
| L9 | 회귀: test_sdd230_org_admin_scope, test_sdd230_member_overview, test_client, tsc | 통과 | pytest/tsc |
