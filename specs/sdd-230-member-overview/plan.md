# SDD-230 — Plan (Stage ②)

> 범위: 1단계(목록+활동). 접속(온라인·최근 접속)은 제외. **DB 마이그레이션 없음**(모든 원천이 기존 컬럼).

## 1. 설계 결정
- 회원 모집단: 기존 `ClientCounselorLink(active)`. 응답은 항상 이 연결로 1차 제한.
- "상담사가 볼 수 있는 세션" = `Session.host_id == 나` ∪ `class_id` 가 내가 active `ClassInstructor` 인 클래스 ∪ `CounselingRelationship.counselor_id == 나`. 이 세션의 **해당 회원 참여자 행**만 읽는다(다른 참여자 행·리포트는 조회 자체를 하지 않음).
- 활동 이벤트(실제 발생만; 예정·리포트 생성/수정은 제외):
  - `session`: 세션 `started_at` 있음 + 참여자 `removed_at` 없음 + 출석상태가 absent/excused/withdrawn/expected 아님. 시각 = `entered_at` → `started_at`.
  - `checkin`: `checkin_state == completed` + `checkin_at`. (수업 전후 체크인; 별도 이벤트)
  - `measurement`: 해당 참여자 `EEGRecord` 중 `file_count>0` 또는 `duration_sec>0`. 시각 = `created_at`. 미착용/미동의는 이벤트 없음(0으로 보간 안 함).
  - `ai_checkin`: `is_ai_enabled()` 일 때만, 내 `AgentCheckin`(closed). AI 비공개면 쿼리 자체를 안 함.
- 마스킹: 연락처 `010-****-1234` 형식(서버). 목록·상세 기본 응답에서 `phone`/`birth_date` 원문 제거. 열람은 `POST /clients/{id}/contact-reveal` (active 연결 재검사, 로거 `audit.client_contact_reveal` 에 필드명·열람자·대상·시각만 기록, 원문 미기록. 영속 감사 테이블은 마이그레이션이 필요해 **만들지 않고 보고**).
- 만 나이: `ClientProfile.birth_date` 기준, KST 오늘 날짜로 서버 계산. 미입력 → null.
- 변화 서사: 승인(`completed`) 된 해당 회원 `client` 리포트의 `class_report_trend_service.compute_change` 재사용. 점수·종합점수·회차간 비교 없음.
- 커서: `base64(isoformat|type|source_id)`, 정렬 `(occurred_at desc, type, source_id)`.

## 2. API 계약 (접두사 /api/v1)
| 메서드·경로 | 변경 | 내용 |
|---|---|---|
| GET /clients | 확장 | 쿼리: `q, page, size, class_id, active_within_days(7/30/90)`. 항목: `gender, age, phone_masked, classes[{id,title}], last_activity_at, last_activity_source, last_session_at(실값)`. 응답에 `class_options[{id,title}]` 추가. 기존 필드 유지(가산). |
| GET /clients/{id} | 변경 | `phone=null, birth_date=null` 고정, `phone_masked, age` 추가. 권한: active 연결 아니면 403(기존). |
| POST /clients/{id}/contact-reveal | 신규 | 응답 `{phone, birth_date}` 원문. 비연결 403, 상담사·기관관리자 외 403. |
| GET /clients/{id}/activity | 신규 | 쿼리 `days(1~365, 기본 30), types(csv), limit(1~50, 기본 20), cursor`. 응답 `{items[{id,type,occurred_at,title,class_title,session_id,note}], next_cursor, ai_included}`. |
| GET /clients/{id}/reports | 신규 | 응답 `{reports[{id,session_id,title,type,status,status_label,occurred_at,created_at}], changes[{report_id,title,occurred_at,state,summary,metrics[{key,label,delta,direction}]}]}`. 해당 회원 `participant_id` 행의 리포트만. |

## 3. 태스크·파일 담당 표 (단일 워커, 순차)
| # | 태스크 | 파일 |
|---|---|---|
| T1 | 서비스: 마스킹·나이·접근세션·활동 집계·리포트/변화 | `backend/app/services/client_overview_service.py`(신규) |
| T2 | 목록 서비스 확장·fix last_session_at·프로필 마스킹 | `backend/app/services/client_service.py`, `backend/app/schemas/client.py` |
| T3 | 라우터: reveal·activity·reports, 목록 쿼리 | `backend/app/api/v1/client.py` |
| T4 | 백엔드 테스트 | `backend/tests/test_sdd230_member_overview.py`(신규) |
| T5 | FE API·순수 유틸(그룹핑·표시 라벨) | `frontend/src/lib/api/clients.ts`, `frontend/src/lib/clients/overview.ts`(신규) |
| T6 | 목록 화면(표 기본+카드, 검색·필터·그룹핑, 복원) | `frontend/src/pages/clients/ClientListPage.tsx` |
| T7 | 상세 화면(요약 헤더·타임라인·리포트·변화·메모) | `frontend/src/pages/clients/ClientProfilePage.tsx` |
| T8 | FE 테스트·스크린샷 | `frontend/tests/sdd230-*.test.ts(x)`, `specs/sdd-230-member-overview/screens/` |

공통 영역(core·models·alembic)은 건드리지 않는다. 마이그레이션 없음.

## 4. 화면 원칙 (시안 준수)
- 라이트 캔버스 #F7F4F0, 브랜드 #5F0080, 흰 패널 20px 라운드, AppShell 재사용. 표 기본, 보기 선택은 localStorage(`mb_clients_view`: 'table'|'cards' 만).
- 390: 표 내부 수평 스크롤 + 이름 열 고정. 카드 단일 열. 페이지 가로 넘침 금지.
- 점수·종합점수·순위 표시 없음. 접속 열·필터·그룹 없음.
- 검색·필터·그룹·페이지는 URL 쿼리(`q, class, days, group, page`)에 저장해 뒤로가기 복원. 연락처·생년월일은 URL/스토리지에 저장하지 않음.
