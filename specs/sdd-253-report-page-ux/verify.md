# SDD-253 — Verify (Stage ③, 구현 전)

## 기준선
- vitest: 358파일 중 8 failed / 17 tests failed (agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd220-native-release, sdd234-a-mobile-home). 신규 실패 0이 기준.
- alembic head: `e036a0245001` → 신규 1개로 단일 head 유지.

## 서버 시나리오
- TS1 권한: 담당 상담사 승인 200 / 허용 기관 활성 기관관리자 200(명상 클래스) / 타 기관 기관관리자 403 / 비활성 기관관리자 403 / 회원 403 / 기관관리자의 상담(비클래스) 승인 403 / 기관관리자 코멘트 편집 403(승인≠편집) / 주강사 대행 승인 기존 유지.
- TS2 감사: 승인 시 approved_by_user_id·approved_by_name·approved_by_role·approved_at 기록, 자동 승인은 approval_source=auto, 재승인·재호출로 최초 값 불변, 승인 전 컬럼 NULL(기존 기록)은 '미확인'으로 응답.
- TS3 발송: 신청 주소 있음→pending, 주소 없음→not_requested, 제외 참가자→unavailable, 예약 예외→failed 이면서 승인 completed 유지, deliver 성공→sent(attempt+1), 실패→failed(code), `sent_at` 은 발송 성공 증거로 바뀌지 않음.
- TS4 approve-and-send: 최초 호출 승인+예약 1회, 재호출 시 예약·감사 중복 없음, 구 `/approve` 후 `/approve-and-send` 도 중복 예약 없음.
- TS5 retry-delivery: failed 만 허용(그 외 409), 성공→sent·승인자/시각 불변, success=false→failed 유지·시도 수 증가, 권한 없음 403, 주소 없음 409. 메일 발송은 모킹(실발송 0).
- TS6 호환: 기존 `/reports`·`/reports/{id}`·`/approve` 응답의 기존 필드·의미 불변(가산만), 회원 목록·상세·토큰 view 응답에 ops 필드 없음(approved_by_name·delivery_*·capabilities 부재), 승인 전 회원 마스킹 유지.
- TS7 계층: 클래스>회차>회원>문서 구조, 상담사는 본인 회차만/기관관리자는 허용 기관만, 1:1은 solo 묶음, 상담사용 클래스 공통 문서는 회차 `common_report`(승인 대기 수 중복 집계 없음), 회원 이름·성별·만 나이 있음/생년월일 필드 없음, 만 나이 생일 전후·윤일·미상, 검색·탭 필터 시 일치 경로 유지·`matched/total` 집계, 페이지가 회차 단위(회원 분리 없음), 리포트 없는 회차 generation_state, 회원(client) 호출 403.
- TS8 정책 유지: 자동 승인 기본 true·명상 미측정 자동 승인 제외 기존 테스트 통과, 마이그레이션 up/down 스모크(오프라인 SQL).

## 화면 시나리오(API 모킹 Playwright, 1440/1200/390)
- UI1 1440: 한 줄 필터·표 헤더 한 번·본문 ≤1200·A안 행(성명·성별·만 나이 / 상태 / 단일 주 버튼)이 줄바꿈·세로 글자·가로 넘침 없음. 1200 동일.
- UI2 상단 배너 '검토가 필요한 회원용 N건 + 검토 시작', 탭 전체/검토 필요/발송 실패 집계, 할 일 우선 정렬(발송 실패→검토 필요→생성 중→승인 완료).
- UI3 검색·탭 필터 시 상위 클래스·회차 경로 유지·자동 펼침, 회차 헤더에 상담사용 공통 보조 버튼.
- UI4 분할 검토: 왼쪽 목록+오른쪽 상세, '승인하고 발송' 단일 CTA, 승인 후 승인자·시각·발송 상태, 실패 시 '다시 발송', 이중 클릭 방지, 기관관리자도 CTA(can_approve) 노출·코멘트 편집은 capability 없으면 숨김.
- UI5 모바일 390: 기존 카드·전체화면 상세 유지(새 계층 화면이 뜨지 않음).
- UI6 회원 목록: '아직 읽지 않음' 표기(NEW 없음), 4컬럼, 상세 '지난 리포트와 함께 보기'(이전 기록 없으면 안내), 점수·순위·종합점수 문구 없음.
- UI7 Tailwind 신규 클래스가 빌드 CSS 에 실제 생성됨.

## Edge Cases
- [ ] 리포트가 한 종류뿐인 회원 / 문서 없는 회원 / 20건 이상 / 긴 한국어 클래스명 / 다자 클래스
- [ ] 승인 후 재조회 실패 시 화면 상태 보존, 코멘트 저장 실패 시 입력 보존
- [ ] 생일 미상 → '나이 미확인', 이름 없음 → '이름 미확인'

## Security Review
- [ ] 회원·토큰 경로로 승인자/발송/capability 필드 누출 없음
- [ ] 계층 API 가 권한 밖 회차·타 기관 회원을 반환하지 않음
- [ ] 로그/응답에 이메일 주소 신규 노출 없음(목록은 마스킹된 존재 여부만)
- [ ] 메일 실발송 없음(모든 테스트 send 모킹), DB 쓰기는 테스트 DB 한정
