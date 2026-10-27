# SDD-248 Plan

## 백엔드
| 파일 | 내용 |
|---|---|
| `app/models/org_inquiry.py` + `models/__init__.py` | OrgInquiry 모델(status, notify_status, consented_at 포함) |
| `alembic/versions/e261027a0248_org_inquiries.py` | head `e261026c0001` 에 연결, 가역 |
| `app/schemas/org_inquiry.py` | Pydantic 검증(길이·enum·허니팟·동의) |
| `app/services/org_inquiry_service.py` | rate limit(Redis INCR+EXPIRE), 저장, 큐 적재, 발송 deliver |
| `app/api/v1/org_inquiries.py` + `v1/__init__.py` | `/public/org-inquiries` 라우터 |
| `app/tasks/email.py` | `send_org_inquiry_notice`(reply_to 지원 위해 `_send_email` 확장, 다중 수신) |
| `app/tasks/report_email_task.py` | `org_inquiry_notice_task` (email_app) |
| `app/config.py` | `org_inquiry_notify_email` |
## 프론트
| 파일 | 내용 |
|---|---|
| `lib/api/org-inquiry.ts` | API 클라이언트(skipAuth) |
| `components/landing/OrgInquiryForm.tsx` | 재사용 폼(검증·상태) |
| `components/landing/CTASection.tsx` | CTA 버튼 + 모달 |
## 테스트
backend `tests/test_sdd248_org_inquiry.py`, frontend `tests/org-inquiry-form.test.tsx`.
## Task 순서
모델/마이그레이션 → 스키마/서비스/API → 메일/태스크 → 백엔드 테스트 → 프론트 → 프론트 테스트 → summary.

## 랜딩 v6 구현 (추가)
- 정답 시안: 대표 승인 design-v6 (`landing.html`·`landing.css`·`assets/`). 카피·섹션 순서·이미지 그대로.
- 구조: `pages/LandingPage.tsx`(조립·모달 상태) + `components/landing/v6/` (`landing-v6.css` 는 `.lv6` 루트로 스코프, `LandingV6Sections.tsx`, `InquiryModal.tsx`, `FloatingInquiryButton.tsx`, `LandingV6Chrome.tsx`(헤더·푸터)). 전역 스타일 영향 0.
- 에셋: 시안 assets → `frontend/public/landing-v6/` (기기 PNG→webp 레티나 폭 유지, web-classes 1600폭 webp, 공식 App Store SVG·Google Play PNG 배지 포함). 폰트는 앱의 Pretendard 사용.
- 모달: 기존 `OrgInquiryForm` 재사용(+`stickySubmit` 옵션으로 하단 고정 제출). 완료 화면은 모달이 `onSuccess` 로 전환. 배경 dim·X·ESC·바깥 클릭 닫기·포커스 트랩·body 스크롤 잠금. CTA 5곳(hero·roles·mid·contact·floating)이 같은 모달 열기.
- 플로팅 버튼: 상시 노출, 모달 열림·`#contact` 가시·`.device/.laptop` 겹침 시 숨김.
- 링크: 로그인(/login)·코드 입장(/join)·웹 시작(/login)·개인정보(/privacy)·계정 삭제 등 내부 라우트 유지. 미사용 기존 컴포넌트(PeopleSection·FeatureCards·ReportPreviewSection·ProcessSection·CTASection)는 삭제하지 않고 import 만 제거.
- 시안 대비 의도된 차이: ① "시안 미리보기" 문구 제거·실제 POST ② 폼은 기존 OrgInquiryForm(동의 1종, 기관유형 enum) 사용.
