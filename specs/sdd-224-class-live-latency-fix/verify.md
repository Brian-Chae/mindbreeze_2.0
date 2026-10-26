# SDD-224 Verify (구현 전 QA 체크리스트)

## BE
- [ ] V1 presign: stream_id `eeg:<uuid>:<uuid>` → 200, object key 에 그대로 포함
- [ ] V2 presign: stream_id `a/b`, `../x`, `a\b`, 빈 문자열, 129자 → 422
- [ ] V3 `_refresh_instructor_rooms` 5초 내 2회 호출 → `_resolve_join` 1회(소켓당)
- [ ] V4 `force=True` 는 간격과 무관하게 실행
- [ ] V5 세션 종료 시 throttle 상태 정리
- [ ] V6 권한 회수(참가자 제거) 후 participant_changed 방송 시 즉시 access_revoked (force 경로)

## FE
- [ ] V7 raw 업로드 422 → 해당 청크 즉시 dead-letter, 다음 flush 에서 재요청 없음
- [ ] V8 raw 업로드 503/네트워크 오류 → 기존대로 재시도
- [ ] V9 상담사 지표 값 72.6666 → 73, BPM 71.234 → 71, 호흡 13.8 → 14, HRV 45.55 → 46
- [ ] V10 링 숫자가 4자리 이상이어도 카드 밖으로 넘치지 않음
- [ ] V11 클래스 만들기 4단계(초대·확인) 회원 탭: 높이 640px 창에서 목록이 220px 로 잘리지 않고 스크롤 가능
- [ ] V12 상담사 셀프뷰: 카메라 켠 상태에서 30초 이상 지속 표시(깜빡임 없음)
- [ ] V13 tsc·vitest·build 통과

## 운영 (dev 배포 후)
- [ ] V14 `journalctl` 에서 `eeg-raw/presign` 422 0건, 200·ack 200 발생
- [ ] V15 `/api/v1/normalization/models/active` → v7 활성 (복구 완료 2026-10-20 ✅)
- [ ] V16 손들기·내 상태 상담사 반영 1~2초 내(수동)
