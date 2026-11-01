# SDD-263 BE 구현 노트

## 구현
- `GET /api/v1/upload-status/overview` (`backend/app/api/v1/upload_status.py`, 서비스 `upload_status_overview_service.py`, 스키마 `upload_status_overview.py`). 마이그레이션 없음, SDD-261 파일 무수정(헬퍼 `_build_participant` 등 import 재사용).
- SQL 4회(후보 1·참여자 1·feature 1·raw 1), 회차 수 무관(PG 실측 4). 캐시 전부 적중 시 1회(후보만).
- 결측은 윈도 함수 대신 스트림별 `max-min+1-count`. 50회차 전부 SDD-261 상세 집계와 0 오차 일치(PG 시험 `test_PG_목록_요약이_회차마다_상세_집계와_일치`).

## 계획과 달라진 점
1. 서비스·스키마를 테스트보다 먼저 작성해 RED 단계를 건너뜀(테스트는 이후 30건 작성·통과). 사후 verify 작성은 아님(verify 는 구현 전 커밋 `90a02d8b`).
2. 오래된 회차 캐시 TTL 60s → 300s (PG 실측 후 조정, spec·contract 동기화). 이유: feature 집계가 지배 비용.
3. 비담당 코치는 403 이 아니라 **빈 목록**(목록은 "내가 볼 수 있는 것"만; 존재 정보 누설 없음). contract §1 에 명시.

## 성능 (임시 PG16, 로컬 맥, 합성 50회차×40명, feature 약 52만 행 + raw 약 10.5만 행)
| 경로 | 결과 | 목표 |
|---|---|---|
| 콜드 200(전 회차 재계산) | p50 1.20s / p95 1.73s | p95 <1.5s — **미달** |
| 평소 200(진행 중 1회차만 재계산, 나머지 캐시) | p50 0.025s / p95 0.032s | <1.5s 충족 |
| 304(캐시 적중) | p95 0.008s, SQL 1회 | <0.15s 충족 |

- 콜드 비용의 대부분은 feature GROUP BY (약 0.8~1.2s, 병렬 Seq Scan / 인덱스 전용 스캔). raw 는 약 0.2s, 파이썬 요약 0.09s.
- 콜드는 프로세스 재시작 직후·캐시 만료 후 첫 요청에만 발생. 오래된 회차는 300s TTL 이라 이후 재계산 안 함. 실제 1시간×1초 회차(40명×3600행)는 본 합성(300행)보다 행 수가 크므로 **dev 서버에서 재측정 필요**(운영·dev 접근 금지로 미측정).
- 개선 후보(미적용): 종료된 회차 요약을 DB 에 저장(마이그레이션), 또는 feature 집계에 `created_at` 별도 쿼리 분리(실측상 이득 없음: 분리 A 1.3s). 필요 시 후속.
- EXPLAIN: feature `ix_eeg_feature_window_participant_created`, raw `ix_eeg_raw_chunk_signal` Index Only Scan(대형 seq scan 없음, 계획 시 통계에 따라 병렬 seq scan 선택 가능).

## 남은 위험
- 프로세스별 캐시(워커 W개면 회차당 최대 W회 계산). 콜드 1.7s 는 첫 요청 지연.
- 후보 `limit` 은 `status` 필터 전에 적용되므로 필터 결과가 limit 보다 적을 수 있다(`total_candidates` 로 판단).
- dev 실데이터 규모 미측정, 읽기 전용 REPEATABLE READ 미적용(회차별 다중 쿼리의 약간의 시점 차 허용 — 내용 해시 ETag 라 정합성 영향은 일시적).
