# SDD-226 Plan — 즉시 클래스

## 아키텍처
- 신규 API 없음. 생성은 `POST /classes/scheduling`(기존 `schedulingApi.create`)에 `recurrence_rule.start_now=true`, fixed·1회·all_one 진행자 1명·rows=[]·ends_on=null.
- 즉석 화면은 마법사와 분리된 새 페이지. 마법사 상태 로직을 건드리지 않는다.
- 스케줄 생성 규칙은 `scheduling-model.ts`에 순수 함수 `instantSchedule(settings, hostId, now)`·`instantTitle(now)`·`loadInstantSettings/saveInstantSettings`로 추가(테스트 대상).

## 파일 소유 (트랙 분리, 겹침 금지)
| 트랙 | 담당 | 독점 경로 |
|---|---|---|
| BE | Claude sonnet-5-5 | `backend/app/schemas/class_parent.py`, `backend/app/services/class_read_service.py`, 신규 `backend/tests/test_sdd226_instant_flag.py` |
| FE | Codex gpt-6.1-sol | 신규 `frontend/src/pages/classes/instant-class-page.tsx`, `instant-class-share.tsx`, `instant-invite-sheet.tsx`, `instant-class.css`, `frontend/src/lib/class-structure/instant-class-model.ts`(+테스트), `App.tsx`(라우트 1줄), `class-scheduling-wizard.tsx`(시작 카드 1개만), `host-classes-page.tsx`, `components/class/structure/class-create-action.tsx`, `host-class-views.tsx`(칩·다시 열기), `lib/class-structure/adapters.ts`, `lib/api/class-structure.ts`(`is_instant?: boolean` 타입), `DashboardPage.tsx`(링크만) |
| 검증 | Codex gpt-6-astra | 읽기 전용 리뷰 + 테스트 실행 |

## Task
- T1 (BE) `is_instant` 가산 + pytest RED→GREEN.
- T2 (FE) 모델 함수 + Vitest RED→GREEN.
- T3 (FE) `/classes/now` 페이지(IC-03, 관리자 지도사, 충돌 시트, 지난 설정, `?from=` 초기값).
- T4 (FE) 공유 화면 IC-04 + 초대 시트 IC-06.
- T5 (FE) 진입점·목록 칩/필터/다시 열기·마법사 시작 카드.
- T6 (통합) 빌드, 초점 테스트, 로컬 브라우저 2클릭 동선, 390px.

## 결정 이유
- 별도 페이지: 마법사는 299줄 단일 컴포넌트로 이미 복잡 → 분기 추가보다 분리가 회귀 위험 낮음.
- localStorage 설정 기억: 서버 스키마 변경 없이 즉시 효과. 기기 공유는 필요 시 2차.
- QR 라이브러리: package.json에 있으면 사용, 없으면 `qrcode` 추가(작은 의존성). 
