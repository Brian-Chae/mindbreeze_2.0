# verify (수정 전 체크리스트)
- [ ] BE: 산출물 presign 응답 upload_headers.Content-Type 이 요청 content_type(application/json)과 무관하게 application/octet-stream
- [ ] BE: ended stream 이 cutoff 후 30분 지나면 sweep 이 closed_at 기록, 30분 이내는 미기록, 이미 closed 는 불변
- [ ] BE: 기존 24h 경로(close_deadline_expired)·abandoned_orphan 정리 테스트 유지
- [ ] FE: normalization/algorithm artifact meta.content_type == application/octet-stream
- [ ] FE: 회차 종료 phase 전이 시 closeBiosignal 1회 호출(중복 호출 없음)
- [ ] pytest(관련), vitest(관련), tsc 통과
