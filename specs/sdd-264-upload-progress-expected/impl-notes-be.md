# SDD-264 BE 구현 노트

- 커밋: B1~B3 `feat` 기대량 보고 PUT / B4 판정·합계 순수 함수 / B5 회차 상세 / B6 목록 / B7 PG 시험. 문서 2건(`docs(sdd-264)`).
- 마이그레이션 `c264e0ec7ed1`(down=`b260c0ffee01`): `session_ingest_expected` 신규(가산). 헤드 1개 확인, PG 에서 upgrade→downgrade→upgrade 통과.

## 계약과 달라진 점

| 항목 | 계약 | 구현 |
|---|---|---|
| ETag | 기대량 지문 | 지문 + **활성 구간 30초 버킷**(정체 120초·종료 30분 유예는 시간 경과로 판정이 바뀌므로 304 가 낡은 상태를 고정하지 않게). 보고가 없는 회차·종료 후 오래된 회차는 버킷 없음 → 304 유지 |
| 상세 쿼리 수 | 6 | 6 확인(PG 실측: 권한 1 + revision 1 + 본문 4) |
| 목록 쿼리 수 | 5 | 5 확인(PG) |
| 목록 ETag | 지문 | `items[].progress` 가 내용 해시에 포함되어 기대량 변화 → ETag 변경(시험 통과). 목록은 시간 경과 버킷 없음(회차 요약 캐시 TTL 안에서만 갱신) |

## 알려진 한계 / 남은 위험

1. **단위 일치는 폰 구현에 달림**: raw 기대 = 폰이 presign 요청 단위로 만든 청크 수, 서버 수신 = `eeg_raw_chunks.uploaded` 행. 폰이 청크를 다른 단위로 세면 영구 `in_progress` 가 된다 → 실기 QA(V-X32)에서 EEG/PPG/ACC 3신호 단위 대조 필요(미확인).
2. 목록 회차 요약 캐시 TTL(진행 중 2s / 종료 30분 내 10s / 그 외 300s) 때문에 목록의 `needs_attention` 전이는 그 TTL 만큼 늦다.
3. `phone_report` 는 호스트의 대리 보고를 허용하지 않는다(업로드와 동일). 호스트 본인이 참여자가 아니면 `expected_unknown`/`not_collected` 규칙과 무관.
4. final=false 로 끝난 회차는 종료 30분 뒤 `expected_unknown`(완료 단정 금지). 폰이 늦게 `final=true` 를 보내면 다시 `all_received` 로 바뀐다.
5. 실제 앱(Android/iOS)·웹 번들에서 보고가 올라오는지는 **확인하지 못했다**(FE 트랙 소관).
