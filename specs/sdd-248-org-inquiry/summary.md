# SDD-248 Summary

## 구현
- `POST /api/v1/public/org-inquiries` (비로그인, 201) — `backend/app/api/v1/org_inquiries.py`
- 서비스: rate limit(IP당 10분 5건, Redis INCR/EXPIRE, Redis 장애 시 fail-open)·저장·큐 적재·발송 — `services/org_inquiry_service.py`
- 모델/마이그레이션: `models/org_inquiry.py`, `alembic/versions/e261027a0248_org_inquiries.py` (down_revision `e261026c0001`, 가역)
- 메일: Celery `email_app` 태스크 `tasks.org_inquiry_notice` (`tasks/report_email_task.py`) → `tasks/email.py::send_org_inquiry_notice` → Resend. `_send_email` 에 다중 수신·reply_to 확장(기존 호출 호환).
- 프론트: `components/landing/OrgInquiryForm.tsx`(재사용 폼), `CTASection.tsx`(CTA 버튼+모달), `lib/api/org-inquiry.ts`. 기존 mailto 링크는 푸터에 유지.

## 결정
- 기존 `/signup-applications/organization`(가입 상담)과 분리 — 영업 문의는 계정 흐름과 무관.
- IP 는 Redis 키(TTL 10분)에만 사용, DB·메일 미기재.
- 허니팟 채움 → 422(저장·메일 없음). 메일 실패/큐 실패여도 접수 201, notify_status(pending/queued/sent/failed)로 추적, Celery autoretry 3회.

## 테스트 결과
- backend `tests/test_sdd248_org_inquiry.py` 21 passed; 인접 회귀(signup/public/org_public/email) 84 passed.
- frontend `tests/org-inquiry-form.test.tsx` 4 passed; `tsc -b` 0 error; 전체 vitest 17 fail/8파일(기준선 동일, 신규 실패 0).

## 운영 반영 사항
1. 마이그레이션: `alembic upgrade head` (org_inquiries 생성, 신규 테이블이라 락 영향 없음).
2. 환경변수: `ORG_INQUIRY_NOTIFY_EMAIL`(선택, 기본 brian.chae@looxidlabs.com, 쉼표 다중). `RESEND_API_KEY`·`RESEND_FROM_EMAIL` 이 설정돼 있어야 실발송.
3. `mindbreeze-email-worker`(Celery email_app, `-Q email`) 재시작 — 신규 태스크 등록 필요.
4. 프록시 뒤라면 `request.client.host` 가 프록시 IP 가 되지 않도록 uvicorn `--proxy-headers`/forwarded-allow-ips 확인(그렇지 않으면 전체 사용자가 한 IP 로 rate limit).
5. 개인정보 보관 1년: org_inquiries 보관 만료 삭제 배치는 미구현(후속).

## 남은 위험
- 보관 1년 자동 삭제·관리자 처리(handled) 화면 미구현.
- 허니팟/레이트리밋만으로는 정교한 스팸 방어 한계(CAPTCHA 미도입).
- 실제 Resend 발송은 로컬에서 검증 불가(mock 검증) — dev 배포 후 실메일 확인 필요.

## 랜딩 v6 구현 (추가)
- 공개 랜딩(`pages/LandingPage.tsx`)을 승인 시안 v6 로 교체. 구성: `components/landing/v6/` (`landing-v6.css` `.lv6` 스코프·`LandingV6Sections`·`LandingV6Chrome`·`InquiryModal`·`FloatingInquiryButton`·`use-inquiry-modal`). 에셋: `frontend/public/landing-v6/` (기기 webp 레티나, web-classes 1600폭 webp, 공식 App Store SVG·Google Play PNG 배지).
- 모달: 기존 `OrgInquiryForm`(`stickyFooter` 옵션 추가) 재사용, 실제 POST. CTA 5곳(hero·roles·mid·contact·floating) 동일 모달. X·ESC·바깥 클릭·포커스 트랩·복귀·하단 고정 제출·완료 화면. 플로팅은 모달/문의 섹션/기기 겹침 시 숨김(1440·390 스캔 겹침 0).
- 시안 대비 차이: ① "시안 미리보기" 문구 제거 ② 폼은 기존 OrgInquiryForm(동의 1종, 기관유형 enum, 오류 한 줄 표시) — 시안의 필드별 오류·선택동의 분리는 미반영 ③ 로그인·코드 입장·약관 등은 SPA 내부 라우트(Link) ④ FAQ "구매"→"LINK BAND가 반드시 있어야 하나요?"(공개 문구 규칙 `PAYMENT_COPY_TERMS` 위반 회피), AI 플래그 off 시 FAQ3 "AI" 문구 제거(기존 공개 정책 테스트 유지) ⑤ 기존 테스트 `fix-store-account-deletion` 의 상담 on/off 랜딩 문구 기대를 v6 카피로 갱신.
- 미사용 기존 컴포넌트(PeopleSection·FeatureCards·ReportPreviewSection·ProcessSection·CTASection·Hero·Nav)는 삭제하지 않고 import 만 제거 — 삭제 여부는 보고.
- 검증: tsc -b 0, vitest 17 fail/8파일(기준선 동일), 신규 `tests/landing-v6.test.tsx` 5건 통과. Playwright 1440/1024/390: 가로 넘침 0·깨진 이미지 0·콘솔 오류 0·제출 POST 0건, CTA 4곳+플로팅 모달 열림(hero·roles·mid·contact은 클릭, floating은 단위 테스트), 필수값 오류, 바깥/X 닫힘. 캡처 `~/.hermes/share/mb-landing-plan-20261027/impl-v6/`.
