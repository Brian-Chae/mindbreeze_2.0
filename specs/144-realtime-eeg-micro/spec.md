# SDD-144 — 실시간·EEG·성능 마이크로 (11건)

## 배경

전체 코드 리뷰 잔여(중·하)에서 실시간 소켓·EEG·성능 마이크로 버그 11건을 추렸다.
소켓 이중 연결·타이머 churn·BLE 중복 emit·raw 잔류 등 실시간/EEG 정합 항목.

## 대상 (11건)

| # | ID | 이슈 | 리스크 |
|---|---|---|---|
| 1 | FE-RT-001 | 소켓 dedup sessionId 단독 → 참여자 확정 재join 차단 | 신원 미확정 |
| 2 | FE-PERF-001 | EEG 파형 setInterval 타이머 churn | 통계 갱신 지연 |
| 3 | FE-PERF-002 | setMetrics in setSession 부수효과 | StrictMode 중복 실행 |
| 4 | FE-RT-004 | /record 소켓 훅별 중복 연결 | 2중 연결 |
| 5 | FE-BAND-001 | useBand 싱글톤 가드 없음 | BLE 중복 emit |
| 6 | FE-EEG-001 | band_connected/upload_status 기본값 오표기 | 단절을 연결로 오표기 |
| 7 | FE-EEG-002 | raw 업로드 실패 청크 영구 잔류 | 큐 잔류·미인지 |
| 8 | FE-PRESENCE-001 | 대기실 presence effect 반복 | join 과다 전송 |
| 9 | FE-DETAIL-001 | 초대 순차 + 중간 실패 미반영 | 목록 정합 불일치 |
| 10 | FE-RT-005 | lastEvent ref 렌더 트리거 없음 | stale 값 표시 |
| 11 | SEC-04(FE) | 401 리로드 /login 하드코딩 | 역할 무시 리다이렉트 |

## 목표

- 실시간 소켓·BLE·EEG 업로드 정합을 바로잡고 리소스 낭비를 제거한다.
- 프론트 318 테스트 통과.
