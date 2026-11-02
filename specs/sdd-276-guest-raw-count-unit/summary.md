# SDD-276 Summary

## 결과
- 폰 보고 기대량 계산을 서버가 세는 단위(올라가 행이 된 청크 수)에 맞춤. JS 번들만, backend·네이티브 변경 0.
- 원인 (a) ppg·acc 부풀림: `computeWebRawTotals` 가 sealed 를 읽은 뒤 receipt 를 따로 읽어, 그 사이 업로드가 끝난 청크가 양쪽에 잡혀 이중 계산 → 최댓값 병합이라 한 번 부풀면 내려가지 않음. **재현 확인**(수정 전 시험 4건 실패). 수정: id 합집합으로 1회만 계산.
- 원인 (b) eeg 부족: 웹 측정이 v2 청크와 별도로 레거시 v1 1초 청크(`useBand`→`useEegRawUpload`)도 같은 `eeg_raw_chunks` 에 올리고 서버는 `signal_type` 만 세므로 eeg 행으로 계산됨. 폰 보고는 v2 만 셌음. **코드 경로 확정, 운영 행 구성은 미확인(추정)**. 수정: v1 청크 생성 수를 IDB 카운터(`next_indices`, 키 `legacy-raw|…`)로 남겨 eeg 에 더함.

## chunk_index 전부 0 (과제 3)
- 서버 UNIQUE = (session, participant, signal_type, stream_id, segment_id, chunk_index). 웹 ppg/acc 는 clock segment 마다 index 0부터 → segment_id 가 달라 별개 행. **덮어쓰기 없음**. 같은 identity 에 다른 checksum 은 409 로 거절되고 폰은 dead_letter 보관.
- 잔존 위험(수정 안 함): chunk_alias 가 stream·segment UUID 앞 8자리만 사용. 충돌 시 alias_conflict 409 로 거절·보관(덮어쓰기 아님).
- 서버 `_raw_stats` 의 이웃 index gap 은 (participant, signal, stream, segment) 분할이라 ppg 의 index-0 행들은 gap 0.

## 변경 파일
web-raw-totals.ts, raw-chunk-queue.ts, use-biosignal-expected-reporter.ts, tests/sdd276/raw-totals-snapshot.test.ts, specs/sdd-276-*

## 시험
- sdd276 6건 통과. 수정 전 web-raw-totals 로 되돌리면 4건 실패(RED 확인).
- 회귀: sdd276·275·274·273·264·266·267·260-web·246-web·244 45파일 380 통과·1 skip. tsc -b 오류 0, eslint 0.

## 확인 못 한 것
- 운영 DB(EC2 SSH/443 시간 초과)로 비회원 행의 v1/v2 구성 직접 확인 못 함. ppg 759 vs 673(+86)이 이중 계산 경쟁만으로 나왔는지, acc 37 vs 32(+5)도 동일한지 미확인.
- 이미 끝난 회차 소급 없음. 실기기(Android/iOS WebView) 실측 없음. 새 회차에서 final 후 일치 여부는 배포 후 확인 필요.
- 네이티브 수정 불필요: 비회원은 두 플랫폼 모두 WebView 웹 경로라 JS 번들 갱신만으로 동시 적용.
