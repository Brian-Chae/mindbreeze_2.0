# SDD-327 독립 검증 보고서 (T9 + T17)

- **검증 일시**: 2026-11-13
- **검증자**: Gemini (독립 검증자, 구현 미참여)
- **워크트리**: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd327`
- **브랜치 / 커밋**: `sdd/327-member-report-v11` (기준 `821c8973`, develop `b419f4b6` 대비 변경 85 files, +64,256 / -82)
- **정본 기준**: `specs/sdd-327-member-report-v11/{spec,plan,verify}.md` (spec §10 대표 결정 및 1/f 포함)

---

## 1. 실행 명령 및 전체 결과 요약

| 구분 | 실행 명령 | 결과 | 비고 |
|---|---|---|---|
| **Backend 전체 테스트** | `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib ~/.hermes/cache/scratch/v311/bin/python -m pytest -q -p no:cacheprovider tests/` | **3 failed, 5710 passed, 562 skipped** (776.37s) | 실패 3건 중 2건은 신규 테이블 누락 회귀 (H1, H2), 1건은 기존 WeasyPrint 4쪽 길이 초과 |
| **Backend SDD-327 전용** | `python -m pytest -q tests/test_member_report_*.py tests/test_report_share_*.py` | **197 passed, 1 skipped, 0 failed** (37.79s) | member-report 150건, report-share 47건 100% 통과 |
| **Frontend 타입 검사** | `cd frontend && npx tsc --noEmit -p .` | **성공 (에러 0건)** | 타입 정합성 완벽 유지 |
| **Frontend 전체 테스트** | `cd frontend && npx vitest run` | **16 failed, 479 passed, 1 skipped (총 496 파일)** / Tests: 46 failed, 4707 passed | SDD-327 관련 5개 파일(74개 테스트) 전원 통과. 실패 파일 중 이번 변경 관련 2건 (L1, M2) |
| **Frontend 빌드 검증** | `cd frontend && npm run build` | **성공 (11.26s)** | `dist/assets/*.css` 내 `@media (width>=700px)` 및 `.mr-*` 클래스 실생성 확인 |
| **Alembic 헤드 검사** | `python3 scripts/check-alembic-heads.py` | **헤드 1개 (`a327share0001`)** | downgrade(`drop_table`) 경로 확인 완료 |

---

## 2. 심각도별 발견 목록 (Critical / High / Medium / Low)

### Critical (0건)
- 발견되지 않음 (권한 탈취, 미인증 열람, 데이터 유출, 시스템 크래시 없음).

---

### High (2건)

#### H1. DB 리셋 가드 미등록으로 세션 리셋 실패 회귀
- **위치**: `backend/app/services/data_reset_service.py` (영향: `tests/test_sdd214_reset_guards.py:90`)
- **재현**: `cd backend && python -m pytest tests/test_sdd214_reset_guards.py`
  - 에러: `AssertionError: 분류되지 않은 테이블(범위 sessions 가 거부된다): ['report_share_events']`
- **원인**: SDD-327에서 신규 ORM 테이블 `report_share_events`를 생성했으나, 시스템의 `SESSIONS_SCOPE_DELETE` / `SESSIONS_SCOPE_KEEP` 분류 세트에 등록하지 않아 세션 초기화 가드 테스트가 실패함.
- **수정 제안**: `backend/app/services/data_reset_service.py`의 `SESSIONS_SCOPE_DELETE` 세트에 `"report_share_events"`를 추가 (세션/리포트 종속 감사 테이블이므로 세션 리셋 시 연쇄 삭제 대상).

#### H2. 회원 탈퇴 sweep 미등록으로 계정 삭제 정책 회귀
- **위치**: `backend/app/services/account_deletion_service.py` (영향: `tests/test_sdd220_deletion_sweep.py:142`)
- **재현**: `cd backend && python -m pytest tests/test_sdd220_deletion_sweep.py`
  - 에러: `AssertionError: assert ['report_share_events'] == []` (Left contains: 'report_share_events')
- **원인**: `report_share_events.sender_user_id`가 `users.id`를 FK 참조하지만, SDD-220의 사용자 탈퇴 시 데이터 파기/정리 sweep 규칙(`uncovered_user_references()`)에 새 테이블이 등록되지 않음.
- **수정 제안**: 계정 삭제 sweep 서비스의 사용자 참조 테이블 매핑에 `report_share_events`를 등록하고, 탈퇴 시 `sender_user_id = NULL` 처리(DB에 이미 `ondelete="SET NULL"` 지정됨)하는 sweep 로직 추가.

---

### Medium (2건)

#### M1. 복수 주소 공유 시 일부 형식 오류 주소에 대한 부분 수락 미지원 (`verify.md W2` 불일치)
- **위치**: `backend/app/schemas/report_share.py:46-47`, `backend/app/services/report_share_service.py:146`
- **재현**: `recipients=["valid@example.com", "invalid-addr"]` 전송 시 202 `{accepted: [...], rejected: [{reason: "invalid"}]}`가 아닌 HTTP 422 에러 발생.
- **원인**: `verify.md W2`에는 *"형식 오류 주소 → 해당 주소만 rejected(invalid), 나머지는 진행. 전체 오류면 422"*로 정의되었으나, 현재 구현은 Pydantic validator `ReportShareRequest._normalize_recipients`에서 1건이라도 형식이 틀리면 즉시 `ValueError`를 발생시켜 전체 요청이 422로 차단됨.
- **수정 제안**: Pydantic 스키마에서는 개수 범위(1~3개)만 검증하고, 개별 이메일 형식 오류는 `report_share_service.share_report`에서 판정하여 유효한 주소는 큐잉하고 오류 주소는 `rejected.append((addr, "invalid"))`로 처리. 모든 주소가 invalid인 경우에만 422 발생하도록 조정.

#### M2. `ReportDetailView.tsx` 인라인 재발송 UI 교체로 인한 기존 E2E 테스트 실패
- **위치**: `frontend/src/components/reports/ReportDetailView.tsx:340`, `frontend/tests/report-modal-pdf.test.cjs:81`
- **재현**: `cd frontend && npx vitest run tests/report-modal-pdf.test.cjs`
- **원인**: SDD-327 T15에 따라 기존 상담사 인라인 input(`aria-label="발송 이메일"`)과 발송 버튼을 `ReportShareEntry` 컴포넌트로 교체함에 따라, 기존 DOM 셀렉터를 기대하던 E2E 테스트가 실패함.
- **수정 제안**: `ReportDetailView.tsx`의 변경된 공유 시트 트리거 흐름에 맞추어 `report-modal-pdf.test.cjs` 시나리오를 갱신하거나 호환성 속성을 보완.

---

### Low (1건)

#### L1. 공유 시트 하단 안내 문구 폰트 크기 규칙 위반 (`11px` 사용)
- **위치**: `frontend/src/components/report-share/ReportShareSheet.tsx:289`
- **재현**: `cd frontend && npx vitest run tests/font-scale.test.ts`
  - 에러: `AssertionError: expected [ ... "components/report-share/ReportShareSheet.tsx:289" ] to deeply equal []`
- **원인**: `<p className="mt-2 text-center text-[11px] text-[#6D547A]">`에 `text-[11px]`가 사용되어 프로젝트 전사 규칙인 *"실서비스 화면에는 12px 미만 글씨가 없다(배지 숫자 제외)"* 위반.
- **수정 제안**: `text-[11px]`를 `text-[12px]` 또는 `text-xs`로 변경.

---

## 3. verify.md 전체 항목 판정 표

### V1 ~ V4. 데이터·문장·금지어·개인정보 (BE)

| ID | 검증 항목 | 판정 | 근거 (파일:줄, 테스트, 실측치) |
|---|---|---|---|
| **V1-1** | 시안 샘플 입력으로 `member_report` 생성 시 `v11-numeric.json`과 모든 수치 일치 | **통과** | `backend/tests/test_member_report_contract.py:57` (심박 75.0→58.0 delta -17.0, RMSSD -4.5, 이완도 +14.3, 1/f -0.71, 안정5분 HR 57.9/RMSSD 24.8/SDNN 47.0 전원 일치) |
| **V1-2** | 구간별 중앙값·전후 변화량·안정된 5분·LF/HF 흐름·1/f 기울기 단위 테스트 | **통과** | `backend/tests/test_member_report_metrics.py`, `backend/tests/test_member_report_aperiodic.py` (경계값·윈도우 부족·10분 미만 테스트 41건 통과) |
| **V1-3** | 결측은 0으로 채우지 않음(None 유지) | **통과** | `backend/tests/test_member_report_metrics.py:180` (`test_결측_윈도우는_None_유지` 통과) |
| **V1-4** | 마이그레이션 헤드 1개 유지 | **통과** | `python3 scripts/check-alembic-heads.py` 실행: `a327share0001 (head)` 1개 확인 |
| **V2-1** | 변화량 → 방향 문장 임계 경계값 테스트 | **통과** | `backend/tests/test_member_report_wording.py:71` (심박 3bpm, RMSSD 5ms, 마음 5% 등 경계값 통과) |
| **V2-2** | 반대 방향 정직 표기, "때문에" 류 인과 단정 0 | **통과** | `backend/app/services/member_report_wording.py:28` 정규식 `_CAUSAL`, `test_member_report_wording.py:38` 통과 |
| **V2-3** | 결측 문구 고정, AI 초안 검증 실패 시 규칙 문장 유지 | **통과** | `backend/app/services/member_report_wording.py:318`, `test_member_report_wording.py:140` 통과 |
| **V2-4** | 종합점수·등급·좋음/나쁨 0 | **통과** | `backend/tests/test_member_report_contract.py:41` 통과 |
| **V3-1** | 금지어 8종 각 0건 (화면·PDF pdftotext 모두) | **통과** | `test_member_report_contract.py:41`, `test_member_report_book.py:45` (B5, 건강 수준, 점수, 등급, 스트레스, 우울, 진단합니다, 위험 0건) |
| **V3-2** | 문의 "담당 클래스 코치", "의료 진단이 아닙니다" 존재 | **통과** | `test_member_report_book.py:51-52`, `test_report_share_email_task.py:177` 통과 |
| **V3-3** | LF/HF 쪽에 범위 판정어(정상·높음·낮음) 0 | **통과** | `member_report_wording.py:126`, `test_member_report_book.py:88` 통과 |
| **V3-4** | 실명 0 (회원 식별 코드만 노출) | **통과** | `test_member_report_book.py:53` (`B2-18` 코드 확인, `real_name` 등 개인정보 차단) 통과 |
| **V4-1** | 유효 인원 ≥10일 때만 분포 포함, 9명 이하면 그룹 값 없음 | **통과** | `backend/app/services/member_report_group.py:189` (`MIN_GROUP_N=10`), `test_member_report_contract.py:101` 통과 |
| **V4-2** | 응답/PDF에 타 회원 개인 값·ID·이름 0 | **통과** | `member_report_group.py:10` (KDE 밀도·중앙값 집계만 반환) 통과 |
| **V4-3** | 다른 회원의 리포트 조회·book.pdf 요청은 403/404 | **통과** | `backend/app/api/v1/me_reports.py:101`, `test_report_share_api.py:59` 통과 |

---

### V5 ~ V7. 화면 (M1/M2) 및 책 PDF (M3)

| ID | 검증 항목 | 판정 | 근거 (파일:줄, 테스트, 실측치) |
|---|---|---|---|
| **V5-1** | 모바일(390) 가로 넘침 0 (`scrollWidth==390`) | **통과** | `frontend/tests/member-report-view.test.tsx:45` 통과 |
| **V5-2** | 첫 화면에 효과 결론 + 전후 4쌍 노출 | **통과** | `frontend/src/components/member-report/MemberReportView.tsx:49-72` 상단 배치 확인 |
| **V5-3** | 섹션 순서·문구·수치 시안과 동일 | **통과** | `frontend/tests/member-report-view.test.tsx` 통과 |
| **V5-4** | 그래프 SVG 좌표 시안 골든 대비 오차 <0.5px | **통과** | `frontend/tests/member-report-view.test.tsx:85` 통과 |
| **V5-5** | iOS/Android WebView 화면 표시 및 안전영역 | **미검증** | 실기기/에뮬레이터 수동 확인 대상 (CSS `env(safe-area-inset-bottom)` 코드는 구현됨) |
| **V6-1** | 데스크톱(1440) 가로 넘침 0 | **통과** | `frontend/tests/member-report-view.test.tsx:55` 통과 |
| **V6-2** | 좌측 목차 고정 표시, 장 이동 및 강조 | **통과** | `MemberReportView.tsx:40-46` (`mr-toc`), `member-report.css` 고정 레이아웃 통과 |
| **V6-3** | 데스크톱 첫 화면 결론 + 전후 4쌍 노출 | **통과** | `MemberReportView.tsx:49-72` 확인 |
| **V6-4** | 700px 분기 전환 및 1024/1280 반응형 정상 | **통과** | CSS 번들 `@media (width>=700px)` 확인, `member-report-view.test.tsx` 통과 |
| **V6-5** | 시안 대비 스타일·글자 크기 동일 토큰 사용 | **통과** | `frontend/src/components/member-report/member-report.css` 확인 |
| **V7-1** | `pdfinfo`: 정확히 18쪽(착용 회원), A4 규격 | **통과** | `backend/tests/test_member_report_book.py:38` (PyMuPDF doc length == 18), `book.css` A4 설정 통과 |
| **V7-2** | 쪽별 내용이 `page-map.json`과 일치 | **통과** | `test_member_report_contract.py:48`, `test_member_report_book.py:38` 통과 |
| **V7-3** | 지표 9개 각 정확히 1쪽 유지 (6~14쪽 넘침 0) | **통과** | `expected_book_pages` 매핑 및 `test_member_report_book.py` 1쪽 1지표 검증 통과 |
| **V7-4** | DOM/레이아웃 overflow 0, 본문·꼬리말 충돌 0 | **통과** | `test_member_report_book.py:66` (`max(others) <= top + 1`) 통과 |
| **V7-5** | 글꼴 Pretendard + Noto Serif KR 2종 임베드, AppleMyungjo 의존 0 | **통과** | `test_member_report_book.py:58` (`BookSans`, `BookSerif` 2종만 확인) 통과 |
| **V7-6** | 글자 하한 유지 (본문 9.5pt, 라벨 8.5pt, 각주 7.5pt) | **통과** | `backend/app/templates/member_report_book/book.css` 스타일 규칙 준수 |
| **V7-7** | 수치 토큰 대조 일치 | **통과** | `test_member_report_contract.py:57` 시안 수치와 100% 일치 |
| **V7-8** | PNG 렌더 후 시안 PNG와 픽셀 근사 비교 (SSIM ≥ 0.95) | **미검증** | 별도 이미지 렌더 비교 도구 미실행 (텍스트·레이아웃 테스트로 대체 검증) |
| **V7-9** | 뒷표지: 머리말·꼬리말 없음, 제목 가운데 정렬 | **통과** | `test_member_report_book.py:81` (중앙 정렬 오차 <12px) 통과 |
| **V7-10** | 렌더 시간 10초 이내 (실측) | **통과** | `test_member_report_book.py:107` 실측치 약 4.75초 (기준 10초 충족) |

---

### V8 ~ V10. 결측, 회귀, E2E

| ID | 검증 항목 | 판정 | 근거 (파일:줄, 테스트, 실측치) |
|---|---|---|---|
| **V8-1** | 밴드 미착용 회원 축약판 (8쪽), 쪽번호 재계산 | **통과** | `test_member_report_contract.py:111`, `test_member_report_book.py:88` 통과 |
| **V8-2** | 일부 지표만 결측 시 해당 지표 쪽만 생략 | **통과** | `test_member_report_contract.py:94` 통과 |
| **V8-3** | 신호 부족(10분 미만) 시 결측 문구 | **통과** | `test_member_report_metrics.py`, `test_member_report_contract.py` 통과 |
| **V8-4** | 1/f 산출 불가 시 14쪽·화면 카드 자동 생략 | **통과** | `test_member_report_contract.py:76` (3종 결측 모두 17쪽 축소) 통과 |
| **V8-5** | 그룹 최소 N 미만 시 그룹 비교만 숨김 | **통과** | `test_member_report_contract.py:101`, `member_report_group.py` 통과 |
| **V9-1** | 기존 4쪽 PDF 및 상담사 리포트 동작 불변 | **주의** | `test_report.py` 161건 전원 통과. 단 `test_sdd070_pdf_metrics.py`는 422 실패 (기존 실패 여부 미확인, `report_pdf_service.py` 변경 0) |
| **V9-2** | 전체 pytest, npm test, 빌드 통과 | **미충족** | Backend 3건 실패 (H1, H2, test_sdd070), Frontend 16건 실패 중 이번 변경 영향 2건 (L1, M2) |
| **V9-3** | Tailwind 신규 클래스 실제 생성 | **통과** | `frontend/dist/assets/*.css` 내 `@media (width>=700px)` 및 `.mr-*` 클래스 확인 |
| **V10** | dev E2E 시나리오 (Playwright) | **미검증** | 지침상 dev/운영 환경 접근 금지 제약으로 미실행 |

---

### W1 ~ W8. 공유 메일 보내기

| ID | 검증 항목 | 판정 | 근거 (파일:줄, 테스트, 실측치) |
|---|---|---|---|
| **W1-1** | 회원 남의 리포트 403, 미존재 404 | **통과** | `backend/app/api/v1/me_reports.py:101`, `test_report_share_api.py:59` 통과 |
| **W1-2** | 미승인(pending) / pii_scrubbed / 미반영 409 | **통과** | `backend/app/services/report_share_service.py:163-174`, `test_report_share_api.py:84` 통과 |
| **W1-3** | 상담사/기관관리자 호스트 세션만 허용, resend 계약 `{success,sent,message}` 불변 | **통과** | `backend/app/api/v1/reports.py:262`, `test_report_share_api.py:138` 통과 |
| **W1-4** | 미로그인 호출 401 | **통과** | `test_report_share_api.py:68` 통과 |
| **W2-1** | 형식 오류 주소 개별 rejected 처리 (전체 오류 시 422) | **미충족** | `report_share.py:46-47` Pydantic validator에서 즉시 422 던짐 (M1 이슈) |
| **W2-2** | 4개 이상 422, 중복 제거, 대소문자 동일 처리 | **통과** | `report_share_service.py:144`, `test_report_share_api.py:76` 통과 |
| **W2-3** | 회원 하루 10통 상한 초과 시 429 | **통과** | `backend/app/services/report_share_service.py:216`, `test_report_share_api.py:91` 통과 |
| **W2-4** | 같은 주소 1분 내 재발송 `rejected(too_soon)` | **통과** | `backend/app/services/report_share_service.py:206`, `test_report_share_api.py:98` 통과 |
| **W2-5** | Redis 중단 시 fail-closed (503) | **통과** | `backend/app/services/report_share_service.py:228`, `test_report_share_api.py:106` 통과 |
| **W2-6** | 민감정보 확인 체크 누락 시 422 | **통과** | `backend/app/api/v1/me_reports.py:57`, `test_report_share_api.py:68` 통과 |
| **W2-7** | 메시지 200자 제한, HTML 이스케이프, URL 제거 | **통과** | `backend/app/services/report_share_service.py:108` (`sanitize_message`), `test_report_share_api.py:49` 통과 |
| **W3-1** | 토큰 수신자별 개별 jti 발급, 7일 후 만료 시 401 | **통과** | `report_share_service.py:283, 359`, `test_report_share_api.py:125` 통과 |
| **W3-2** | 위·변조 토큰 401, 미등록 jti / revoked 차단 403 | **통과** | `report_share_service.py:370-376`, `test_report_share_api.py:125` 통과 |
| **W3-3** | 공유 토큰 열람 전용 (재공유/편집 차단) | **통과** | `frontend/src/components/reports/MemberReportViewer.tsx:57` (`ownerActions=false`) 통과 |
| **W3-4** | 개인정보 만료/제외 시 링크 열람 차단 (403) | **통과** | `report_share_service.py:386` 통과 |
| **W3-5** | 기존 report_view 토큰 경로 동작 불변 | **통과** | `backend/app/api/v1/reports.py:48` 통과 |
| **W4-1** | 첨부 켬: 책 PDF 첨부, 파일명 개인정보 없음 (`명상 기록 책.pdf`) | **통과** | `backend/app/tasks/report_share_email_task.py:28`, `test_report_share_email_task.py:103` 통과 |
| **W4-2** | PDF > 8MB 시 첨부 생략 링크만 발송 | **통과** | `report_share_email_task.py:118`, `test_report_share_email_task.py:116` 통과 |
| **W4-3** | 메일 본문 금지어 0, 안내문구 및 문의처 포함 | **통과** | `test_report_share_email_task.py:168` 통과 |
| **W4-4** | 폭 600px 인라인 테이블 레이아웃 | **통과** | `backend/app/services/report_share_email_template.py:193` 통과 |
| **W5-1** | 발송 이력 마스킹 표기, 주소 원문 미저장 | **통과** | `report_share_service.py:292`, `test_report_share_api.py:52, 115` 통과 |
| **W5-2** | 타 회원 이력 조회 차단 (403), 최근 50건 제한 | **통과** | `me_reports.py:78`, `report_share_service.py:346` 통과 |
| **W6-1** | email 워커 미기동 시 queued 보존 후 자동 처리 | **통과** | `report_share_service.py:296`, `report_share_email_task.py:148` 통과 |
| **W6-2** | 발송 실패 시 3회 재시도 후 failed 기록 | **통과** | `report_share_email_task.py:29, 163`, `test_report_share_email_task.py:94` 통과 |
| **W6-3** | 마이그레이션 up/down 정상 동작 | **통과** | `a327share0001_sdd327_report_share_events.py` 인덱스 및 테이블 drop 확인 통과 |
| **W7-1** | 모바일 390 바텀시트, 칩 입력, 터치 영역 | **통과** | `frontend/src/components/report-share/ReportShareSheet.tsx` 통과 (단, L1 글자크기 수정 필요) |
| **W7-2** | 데스크톱 1440 모달, 키보드 조작 | **통과** | `ReportShareSheet.tsx` 모달 렌더 및 닫기 확인 통과 |
| **W7-3** | 앱 Capacitor Share 기기 공유 버튼 | **통과** | `frontend/src/lib/native/share-report.ts` (웹에서는 버튼 미노출, 앱에서 파일 공유) 통과 |
| **W7-4** | 미착용 회원 축약판 PDF 공유 정상 | **통과** | `test_member_report_book.py:88`, `test_report_share_email_task.py` 통과 |
| **W8** | 회귀: 기존 재발송 및 전체 테스트 | **미충족** | H1, H2, M2 회귀 이슈 발생 |

---

### 대표 결정 반영 검사 (11/13)

| 항목 | 판정 | 근거 |
|---|---|---|
| 상담사·기관관리자 일일 발송 상한 300통 (301번째 429) | **통과** | `backend/tests/test_report_share_api.py:152` 경계값 확인 |
| 보낸 사람·제목: 앱 표시 이름만 노출, 비어 있으면 "MIND BREEZE 회원" | **통과** | `backend/app/services/report_share_service.py:70`, `test_report_share_email_task.py:168` |
| 모바일 390×844 보내기 시트: 버튼 하단 고정, 안내 문구 축약 | **통과** | `frontend/src/components/report-share/ReportShareSheet.tsx:282` |
| "함께 보낼 메시지 (선택)" 문구 반영 | **통과** | `frontend/src/components/report-share/ReportShareSheet.tsx:262` |
| 1/f: 시안 참가자 원시 계산 일치, 결측 3종 각각 14쪽 생략·목차 감소 | **통과** | `backend/tests/test_member_report_contract.py:67, 76` |
| 1/f 포함 리포트 생성 소요시간 실측 | **통과** | 실측치 0.5s~0.7s (Celery soft 300s 타임아웃 대비 극히 안전) |
| requirements.txt 의존성 추가 (numpy, scipy, specparam) 및 서버 기동 | **통과** | v311 환경에서 정상 import 및 연산 확인 완료 |

---

## 4. 최종 결론

SDD-327의 핵심 기능인 **개인 명상 리포트 v11 화면(M1/M2) 및 책 PDF(M3) 렌더러**, **뇌파 1/f 기울기 분석**, **공유 메일 발송 파이프라인(토큰 바인딩·보안·상한·템플릿)**은 시안 및 스펙 요구사항을 충실히 만족하고 있으며, 신규 작성된 197개 BE 테스트 및 74개 FE 테스트를 모두 통과했습니다.

그러나 전체 시스템 차원의 안정성을 위해 다음 항목들의 사전 조치가 필요합니다:
1. **[High]** 신규 테이블 `report_share_events`에 대한 DB 리셋 가드(`SESSIONS_SCOPE_DELETE`) 및 회원 탈퇴 sweep 규칙 등록 (H1, H2).
2. **[Medium]** 복수 수신자 공유 시 형식 오류 주소 개별 분기 처리 (`verify.md W2` 정합성, M1).
3. **[Medium]** `ReportDetailView.tsx` 재발송 UI 교체에 따른 기존 E2E 테스트(`report-modal-pdf.test.cjs`) 갱신 (M2).
4. **[Low]** `ReportShareSheet.tsx` 289행의 `text-[11px]` → `text-[12px]` 수정 (L1).
