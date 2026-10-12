# SDD-092 프론트엔드 구현 결과 — T10~T15

작성일: 2026-09-25
범위: 현재 mindbreeze_2.0 저장소의 Mind Breeze 채팅 프론트엔드만.

## 구현

- T10: `chat.ts` 참여자 role 타입 확장, `chat-invite.ts`에 상담사 후보 조회·fork 요청 및 초대 권한/메타데이터 어댑터 추가.
- T11: `use-chat-invite.ts`에 대상 선택 → 방식 선택, 역할별 검색/페이지, 250ms 지연 검색과 응답 역전 차단, 혼합 선택(최대 100명), 제출 전 참여자 재검증과 요청 잠금 구현.
- T12: `InviteMemberModal.tsx` 2단계 모달. 기존 대화 공개 확인, direct 기존 추가 비활성과 사유, 선택적 새 방 이름, 모바일 시트/데스크톱 모달, 포커스 가두기·복귀·배경 inert 적용. 순수 Tailwind 및 #5F0080 사용.
- T13: 메뉴·설정·모바일 대화 상단 진입점 연결. 상담사 host/org_admin에만 노출. 기존 즉시 추가 폼 교체. 이름 미저장 시 저장/취소 후 초대, 초대 취소 시 설정 복귀. 기존 이름 변경·host 내보내기 유지.
- T14: ID 기반 upsertRoom으로 새 방 삽입 후 이동. 기존 방·메시지 캐시·읽음 상태 보존. 목록 조회 시작 시 스냅샷을 전달하여 지연 응답이 새 방과 이후 갱신을 덮지 않도록 보완.
- T15: 실제 ClientChatPage 메뉴·설정에서 초대 UI 비노출 및 후보 API 미호출 테스트. 목록 갱신에도 동일한 스냅샷 보호 적용.

## 확정 결정 적용

- UX 초안보다 Brian의 이번 지시와 spec.md를 우선: org_admin 초대 UI 허용, GET /chat/invitable-counselors 및 POST /chat/rooms/{id}/fork 사용.
- 새 방 이름을 비워 두면 name을 생략하여 서버 기본값 사용.
- 미확정 request_id, can_invite, 사용자별 실시간 이벤트는 추가하지 않음.
- fork 응답 유실/5xx는 결과 불명확으로 안내하고 현재 모달의 재실행을 차단. 서버 멱등 계약이 없으므로 모달을 닫고 다시 실행하는 경우까지 중복 생성을 보장하지 않음.
- 독립 코드 리뷰에서 발견한 지연 목록 응답 경합은 실패 테스트로 재현 후 수정. 방 경로 변경 시 초대 모달 종료도 회귀 테스트로 검증.

## 검증 결과

frontend 디렉토리에서 실행:

- `npm run test:chat`: 종료 코드 0, 6개 파일 / 38개 테스트 통과.
- `npm run build`: 종료 코드 0, TypeScript 및 Vite 빌드 통과.
- `git diff --check -- frontend`: 통과.

테스트 내용: 확정 API 경로/payload, 권한별 진입점, 기관 관리자(명단 조회 허용 계약을 모킹), 내담자 실제 페이지 비노출, direct 제한, 대화 공개 확인, 혼합 선택, 검색 응답 역전, 페이지 추가, 선택 상한, 참여자 변경/조회 실패, 중복 제출, 403/422/응답 유실, 새 방 삽입 및 원본 보존, 메뉴 키보드, 설정 복귀, 라우트 변경.

DOM 회귀 테스트용 jsdom 개발 의존성 추가. 실행 환경의 NODE_ENV=production 때문에 React act가 비활성화되는 현상을 확인하여 test:chat 스크립트에 NODE_ENV=test 명시. 기존 Storybook/Vite peer dependency 충돌 때문에 설치는 --legacy-peer-deps --include=dev로 수행.

빌드에 기존 디자인 토큰 CSS import 해석 경고와 500kB 초과 청크 경고가 있으나 종료 코드는 0. 실제 백엔드/브라우저 통합 E2E는 수행하지 않음.

## 백엔드 연동 확인 필요

구현 중 병행 변경된 백엔드 파일을 읽어 확인했으며 이 작업에서 수정하지 않음.

1. `backend/app/services/chat_service.py`의 `get_room_participants()`는 현재 `_ensure_group_host()`를 호출함. org_admin이 호스트가 아닌 그룹방에서는 GET participants가 403이므로 프론트엔드가 참여자 확인 단계에서 안전하게 중단함. 기관 관리자 초대의 실제 연동 완료에는 초대 가능 기관 관리자에 대한 명단 조회 허용이 필요함. UI/훅 테스트는 조회가 허용된 계약을 모킹함.
2. `backend/app/schemas/chat.py`의 `InvitableCounselorsResponse`에는 현재 counselors만 있음. 사용자 확정 응답의 total/page 및 조회 page/size 처리와 차이가 있음. 프론트엔드는 확정 계약대로 구현함.

프론트엔드 구현·자동 검증 결과이며 백엔드 연동 승인 및 전체 SDD 완료 선언을 대체하지 않음.
