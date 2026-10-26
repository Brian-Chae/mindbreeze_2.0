# SDD-224 Summary

## 구현
- BE: raw presign stream_id 콜론 허용(`/`·`\`·`..` 거부 유지), `_refresh_instructor_rooms` 세션별 5초 throttle. join·세션 상태·참여자 구성·멤버 제외(effect `live_access_reconcile`)는 force(즉시). 대기실 heartbeat 방송은 throttle.
- FE: raw 업로드 재시도 불가 4xx(400/403/404/409/413/422) 즉시 dead-letter(S3 PUT 실패는 재시도 유지), 상담사 지표 정수 반올림 + 링 숫자 넘침 방지, 클래스 만들기 회원·이메일 목록 최소 320px, 셀프뷰 재attach 방지·LiveKit 로컬 트랙이 있으면 녹화기 오류로 숨기지 않음.
- 운영: dev 표준 모델 0건 → 하루밴드 데이터 복구(기준측정 6·모델 11, 활성 v7).

## 디버깅
- CI PG 스모크 `test_v36_real_websocket_effect_consumer_revokes_room[remove]` 실패: 멤버 제외 effect 의 권한 재검사가 throttle 에 걸려 access_revoked 가 안 나감 → force=True 로 수정(로컬 PG 에서 수정 전 실패·수정 후 통과 재현).

## 테스트
- backend pytest(PG 제외) 3202 passed / 12 skipped, PG 435 passed, CI 3잡 pass.
- frontend tsc 0, vitest 2175 passed / 12 failed(7파일, develop 899a4193 에서도 동일 실패 — 신규 0).

## 배포
- PR #26 develop 머지(5c5c190f), Deploy Dev(dd334ae4) frontend·deploy success, 서버 09:19 UTC 재시작·코드 반영 확인.

## 남은 확인
- V14 실 클래스에서 presign 200·ack 200 발생(배포 후 아직 클래스 트래픽 없음).
- V12·V16 실 카메라 셀프뷰 30초 지속, 손들기·내 상태 1~2초 반영 — 수동 확인 필요.
