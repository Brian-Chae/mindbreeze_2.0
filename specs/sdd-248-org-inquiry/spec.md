# SDD-248 — 기관 도입 문의 접수와 메일 알림

- 상태: Stage ① Spec
- 브랜치: `sdd/248-org-inquiry`
- 작성일: 2026-10-27

## 배경·목적
- 공개 랜딩의 '이메일로 도입 문의'(mailto)는 접수 추적이 안 된다. 폼 → 백엔드 저장 → 운영자 메일 알림으로 바꾼다.
- 기존 `/signup-applications/organization`(SDD-073)은 가입 상담용이며 계정 흐름과 얽혀 있다. 영업성 도입 문의는 별도 테이블·엔드포인트로 분리한다.

## 범위
1. 비로그인 `POST /api/v1/public/org-inquiries` (201).
2. `org_inquiries` 테이블 + Alembic 마이그레이션, `status`(new/handled).
3. 저장 후 Celery `email_app` 태스크로 운영자 메일 비동기 발송. 메일 실패해도 접수는 201.
4. 랜딩 CTA + `OrgInquiryForm`(재사용 컴포넌트) + 개인정보 동의, 제출 상태 표시.

## 비범위
- 관리자 목록·처리(handled 전환) 화면, 자동 회신 메일, 랜딩 리디자인.

## 요구사항
### API
- 필수: org_name, contact_name, email, phone, privacy_consent(true). 선택: org_type(counseling_center|meditation_center|education|company|other), expected_users(int ≥0), band_interest(bool), message(≤2000자).
- 허니팟 `website` 는 비어 있어야 함(채워지면 422 아닌 조용한 거절 대신 422로 거절 — 봇에 신호 최소화 위해 일반 메시지).
- IP당 10분 5건 rate limit(Redis), 초과 시 429.
- 길이 제한: org_name 200, contact_name 100, email 254, phone 30.
### 메일
- 수신: 설정 `ORG_INQUIRY_NOTIFY_EMAIL`(기본 brian.chae@looxidlabs.com, 쉼표 다중).
- 제목 `[MIND BREEZE] 기관 도입 문의 — {기관명}`; 본문에 전 필드 + 접수 시각(KST); IP 미기재; reply_to=문의자 이메일; HTML 이스케이프.
- 큐 적재 실패·발송 실패는 로그(마스킹) + notify_status 로 추적, 재시도(Celery autoretry 3회).
### 프론트
- 성공 문구: '문의가 접수되었습니다. 영업일 기준 2일 안에 회신드릴게요.'
- 동의 문구: 목적 도입 상담 회신 / 항목 기관명·이름·이메일·연락처·문의내용 / 보관 1년.

## 개인정보
- IP 는 rate limit 키(Redis, TTL 10분)에만 사용하고 DB·메일에 저장하지 않는다. 동의 시각을 저장한다.
