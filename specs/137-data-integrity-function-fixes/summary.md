# SDD-137 — 2순위 데이터 무결성·기능 6건

## 원인 분석

전체 코드 리뷰 2순위 6건. 공통 원인은 **"종료·재연결·삭제 같은 경계 상황에서의 정리 로직 누락"** — 정상 흐름에서는 드러나지 않지만 특정 상황에서 데이터 유실·영구 차단·FK 오류를 일으킨다.

| # | 결함 | 원인 |
|---|---|---|
| DATA-01 | 계정 삭제 FK 오류 | `admin_service` 자식 테이블 정리 목록에 소속·가입신청 누락 + 기관 owner/deactivated_by 참조 미해제 |
| FE-JOIN | 게스트 이름 미입력 영구 차단 | `joinStartedRef` 잠금이 early-return·resetJoin 에서 미해제 |
| FE-REC | 기록지 실시간 갱신 중단 | `useRecordSocket` 재연결 시 방 재구독 없음 |
| FE-AUDIO | 녹음 마지막 구간 유실 | `useAudioRecorder` 종료 시 마지막 청크 flush 대기·실패 청크 재전송 없음 |
| VID-01 | 영상 병합 중단 | 병렬 병합에서 선행 청크 실패 시 `while next_idx in pending` 루프가 멈춰 뒤 청크 미기록 |
| RPT-01 | 리포트 재생성 즉시 실패 오판 | `generation_started_at` 이 이미 있으면 갱신 안 해 워치독이 즉시 '먹통' 오판 |

## 변경 내용

**백엔드 (3건)**
1. `admin_service.py` — 계정 삭제 시 `user_org_memberships`·`signup_applications`(user_id, reviewed_by) 정리 추가 + `organizations.owner_user_id`·`deactivated_by` SET NULL.
2. `video_service.py` — 병렬 병합에서 실패 청크도 `b''` 로 표시해 순차 flush 가 멈추지 않게 수정(선행 실패에도 뒤 청크 기록).
3. `report_task.py` — 재생성 시 `generation_started_at` 을 항상 리셋.

**프론트 (3건)**
4. `class-join-page.tsx` — 게스트 이름 미입력 early-return·`resetJoin` 에서 `joinStartedRef` 잠금 해제.
5. `useRecordSocket.ts` — `connect` 이벤트에서 기존 구독 방 자동 재구독.
6. `useAudioRecorder.ts` — `useVideoRecorder` 와 동일하게 종료 시 마지막 청크 flush 대기 + 실패 청크 `{index, blob}` 재전송. `ClassPlayerPage.tsx` 의 `handleStop` 에서 `await recorder.stop()` 으로 flush 완료 후 서버 stop 호출.

## 검증 결과

| 검증 | 결과 |
|---|---|
| 백엔드 `pytest -q` | **1009 passed / 12 skipped / 0 failed** |
| 프론트 `vitest run` | **44 files / 318 tests 전부 통과** (브라우저 테스트 4파일은 dev 서버 기동 후 통과) |
| 프론트 `npm run build` | **0 errors** |
| `py_compile` 수정 3파일 | 통과 |
