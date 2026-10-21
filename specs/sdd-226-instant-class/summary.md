# SDD-226 — 즉시 클래스 구현 결과 (초안)

- 작성일: 2026-10-21
- 범위: FE T2~T5, V02~V16. Brian 최종 리뷰 전 초안.
- 브랜치: `sdd/226-instant-class`

## 구현

- `/classes/now` 한 화면에서 기본 30분·온라인·정원 10명으로 개설. 관리자 진행 지도사 필수, 오프라인 주소 필수.
- KST 자동 제목, 사용자별 설정 저장/복원, `?from=` 상세 설정 재사용. 이름·초대 대상은 저장하지 않음.
- 기존 `defaultSchedule` / `scheduleProblems` 및 preview→create 계약 재사용. fixed·1회·start_now·all_one 1명, 충돌 확인 시 force/fingerprint, 같은 요청 재시도 operation_key 유지.
- 공유 화면에서 코드·링크 복사·실제 QR 생성. URL/QR은 코드 없는 `${location.origin}/join`. 자동 이동 없이 상담사는 player, 관리자는 회차 확인.
- 회원/이메일 두 탭 초대. 기존 picker와 이메일 발송 상태 컴포넌트 재사용. 게스트 포함 현재 정원 계산, 인원 확인 실패 차단, 네트워크 재시도 명령 유지, stale revision 재조회, 관리자 대행 사유 입력.
- 목록/대시보드/기존 마법사 진입점, 즉석 칩·필터 및 완료 클래스 다시 열기 추가. 마법사 기존 상태 로직은 수정하지 않음.
- 시안의 background4/5 및 기존 몰입형 토큰 재사용. 모바일 고정 CTA, 가로 대형 화면 오른쪽 초대 시트, 나머지는 하단 시트.

## 변경 파일

- `frontend/src/lib/class-structure/instant-class-model.ts`
- `frontend/src/pages/classes/instant-class-page.tsx`
- `frontend/src/pages/classes/instant-class-share.tsx`
- `frontend/src/pages/classes/instant-invite-sheet.tsx`
- `frontend/src/pages/classes/instant-class.css`
- `frontend/src/App.tsx`
- `frontend/src/components/class/structure/class-create-action.tsx`
- `frontend/src/components/class/structure/host-class-views.tsx`
- `frontend/src/pages/classes/host-classes-page.tsx`
- `frontend/src/lib/class-structure/adapters.ts`
- `frontend/src/lib/api/class-structure.ts`
- `frontend/src/pages/classes/class-scheduling-wizard.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/package.json`, `frontend/package-lock.json` (`qrcode`, `@types/qrcode`)
- `frontend/tests/instant-class-model.test.ts`
- `frontend/tests/instant-class-entry.test.tsx`
- `frontend/tests/instant-class-page.test.tsx`
- `frontend/tests/instant-invite-sheet.test.tsx`
- 본 `summary.md`

## 검증

- TDD: 모델/진입점/화면 누락 RED 확인 후 GREEN. 저장된 사용자 지정 35분의 직접 입력 표시도 RED 재현 후 수정.
- 신규 26개 + 기존 관련 207개, 총 **12파일 233개 통과**. 기존 wizard/바로 지금/복제/클래스 데이터·탐색·호스트·회원 화면·생성 액션 포함.
- `npx tsc --noEmit -p .`: 성공. 프로젝트 실제 타입 검사 `tsc -b`도 빌드 단계에서 성공.
- `npm run build`: 성공. 기존 chunk 크기 및 정적/동적 import 혼용 경고 존재.
- 전체 `npm test` 추가 실행: **205파일 중 198통과/7실패, 2453개 중 2441통과/12실패**. 이 실행 뒤 추가한 `?from` 테스트 및 저장된 35분 강화 검증은 위 233개 초점 검사에서 재확인. 전체 green 아님.
- 전체 실행의 범위 외 실패(수정하지 않음, 별도 원본 체크아웃 기준선 실행은 하지 않음):
  - `agent-counselor-page.test.tsx` 2개: 브리핑 기대값/입력 DOM 불일치.
  - `chat-message-deeplink.test.ts` 2개: missing/failure 상태 기대값 불일치.
  - `font-scale.test.ts` 1개: `DashboardPage.tsx:490` 기존 11px 글씨. 이번 수정은 425행 링크만.
  - `org-counselor-management-browser.test.cjs` 1개, `org-management-browser.test.cjs` 2개: 기존 브라우저 harness 요소 탐색 timeout.
  - `report-modal-pdf.test.cjs` 2개, `report-server-pdf.test.cjs` 2개: 별도 앱 서버 연결 `fetch failed`.
- 설치: 요청한 `npm ci`는 기존 Storybook 8/Vite 8 peer 충돌로 ERESOLVE. `npm ci --legacy-peer-deps`로 622개 설치 후 QR 의존성 추가. 기존 의존성 취약점 자동 수정은 하지 않음.
- 독립 검증자가 실제 Chrome headless에서 모든 API를 대역 처리하여 확인:
  - 390×844 IC03/IC04 `scrollWidth=390`, CTA 하단 유지.
  - IC06 390×844 하단, 1194×834 가로 x714/폭480 오른쪽, 834×1194 세로 하단.
  - 입력 없는 생성→공유 유지, 코드/QR URL/player 링크, 관리자 미선택 차단→선택 활성, 오프라인 주소 차단.
  - 충돌 시트 1개→force/fingerprint, 비공개 제목 숨김, 회원 초대 revision/reactivate/operation_key, 시트 닫힘/토스트.
  - 모바일 5개 시간 칩 및 진행 방식 한 줄. 개발 StrictMode의 취소된 초기 응답 오류도 방지.
- 로컬 검증 기록: `/tmp/sdd226-focused-final.log`, `/tmp/sdd226-build-final.log`, `/tmp/sdd226-all-tests-final.log`, `/tmp/sdd226-browser-final.log`. 스크린샷 `/tmp/sdd226-ic03-390.png`, `/tmp/sdd226-ic04-390.png`, `/tmp/sdd226-ic06-390.png`, `/tmp/sdd226-ic06-1194.png` (임시 파일).

## 남은 이슈 / 검증 경계

- 실제 BE/DB 통합 생성·동시 편집·Celery 발송·수신함 도착·LINK BAND 하드웨어는 이번 검증 대상 아님. 실제 메일/알림 발송 없이 대역으로 검증.
- 전체 테스트의 위 12개 실패 및 일반 `npm ci` 의존성 충돌은 별도 정리 필요.
- 시안 토큰과 반응형 실제 화면은 확인했으나 전 화면 픽셀 단위 이미지 회귀 검사는 수행하지 않음.
- BE `is_instant` 제공 작업은 다른 트랙 소유이며 변경하지 않음. Brian 최종 리뷰 대기.
- 시작부터 존재한 미추적 `designs/instant-class/standalone.html`은 유지하고 커밋에서 제외.
- 로컬 커밋만 수행. push·배포·머지·삭제·실제 메일 발송 없음.
