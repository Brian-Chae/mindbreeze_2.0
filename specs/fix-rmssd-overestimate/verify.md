# Verify — RMSSD 과대 산출 수정 시 검증 시나리오 (구현 전 작성, 수정은 대표 승인 후)

> 수정 대상: PPG RR 검출(양방향 필터 · 창 끝 피크 보류 · 포물선 보간). plan.md §6 참고.

## V1. 원시 PPG 회귀 (53명, 로컬 하네스)
1. 수정 전 하네스 결과 저장(현재: RMSSD 중앙 117.2 / SDNN 77.5 / pNN50 63.6).
2. 수정 후 동일 입력 재생(500샘플 버퍼, 0.5초·1초 간격 둘 다).
3. 합격: RMSSD 중앙 30~45ms · SDNN 중앙 30~55ms · 재계산 `data.csv`와 순위 상관 ρ ≥ 0.9 · 사람별 중앙값 비(서비스/재계산) 중앙 0.9~1.15 · 사람별 SDNN/RMSSD 중앙 ≤ 1.2 · HR 중앙 절대차 ≤ 1.5회/분 · 산출 가능 인원 수가 수정 전 대비 −10% 이내.
4. 불합격 시: 창 끝 보류 폭(1초)·필터 패딩 길이 조정 후 재시험(과적합 방지를 위해 회차별 분리 검증 b1/b2/m).

## V2. 합성 신호 (알려진 RMSSD 주입)
- 평균 64회/분, RR에 무작위 변동(목표 RMSSD 15 / 40 / 80ms)을 얹은 PPG(2차 고조파·딕로틱 노치 포함, 50Hz, 잡음 SNR 2수준).
- 합격: 추정 RMSSD 가 목표의 ±5ms(또는 ±12%) 이내, 15ms 구간에서 양자화 하한 오차 ≤ 5ms(포물선 보간 효과 확인), HR ±1.
- 호흡성 동성 부정맥(0.25Hz 변조)이 있는 신호에서 RMSSD/SDNN 비가 1을 넘지 않는지.

## V3. 경계·품질
- 창 끝 보류: 박동이 창 끝 직전에 있는 경우 다음 창에서 정확히 한 번 확정(중복·누락 0, 중첩 창 `AnalysisMetricsService` 커서 로직과 정합).
- 접촉 변화·움직임 구간: 지터 경보/null 처리, 0 치환 없음(기존 가드 `087d1c3b` 무회귀).
- 미착용(`not_worn`)·RR 게이트 재시드(SDD-316): `sdd316_not_worn`, 재시드 테스트 통과.
- 시작 직후 30초 미만: `rmssd` null 유지.

## V4. TS ↔ Rust 정합
- 같은 입력에 대해 TS 처리기와 `measurement-core`(cargo test, wasm) 의 RR/RMSSD 가 허용 오차 내 일치(golden oracle 갱신분 포함).
- 기존 테스트 무회귀: `frontend/tests/sdd244-*.test.ts`, `packages/measurement-core/tests/{sdd314_hrv_gates,sdd316_not_worn,golden_oracle,engine_invariants}.rs`, `backend/tests/test_sdd036_hrv_motion.py`.

## V5. 하위 영향
- 리포트 서사: SDNN 기반 "심박변이" 변화량 문구(±5ms 임계) 가 수정 후에도 합리적(이전 대비 변화량 분포 확인, 문구 템플릿 변경 없음).
- 이완도·감정안정도·집중도 값이 수정 전후 **동일**(HRV 비의존 확인).
- 데이터센터 내보내기·연구 내보내기 단위(ms)·컬럼 불변. `algorithm_version` 필드 도입 시 롤업 서비스가 혼재 버전을 구분.

## V6. 과거 데이터 처리 (선택지별)
- A(재계산): 표본 세션 3개로 건식 실행 → 재계산값 vs 독립 스크립트(`internal-indiv/_w`) 차이 ≤ 10%. 쓰기는 읽기전용 트랜잭션 검증 후 건별 승인.
- B(표기만): 리포트·화면 미리보기에서 절대 수치가 노출되지 않는지 화면 확인.
- C(그대로): 신규/과거 구분 라벨이 보이는지.

## V7. 실제 동작 확인 (dev)
- dev 배포 후 실제 LINK BAND 측정 1건: 앉은 안정 상태 5분 RMSSD 가 20~60ms 범위, SDNN ≤ ~70ms, HR 정상. 화면(실시간·리포트)에서 값 확인(빌드 통과만으로 완료 처리 금지).

---

## 이번 구현 범위 보강 (2026-11-13, 대표 결정 반영)

> 결정(대표 원문): "알고리즘 고치고 이미 저장된 데이터는 새로 고친 알고리즘으로 다시 산출해서 바꿔줘. 버전별로 수치를 따로 저장하면 너무 많은 저장 공간을 차지."
> → **제자리 덮어쓰기(UPDATE). 버전별 컬럼·테이블·사본 저장 금지. 마이그레이션 0.** 위 V5의 `algorithm_version` 혼재 구분·V6의 A/B/C 선택지는 A(재산출, 덮어쓰기)로 확정되어 대체된다.
> 참고: 이미 존재하는 `feature-collector.ts` 의 `ALGORITHM_VERSIONS.ppg`(원시 아티팩트 메타 스냅샷 용도)는 '2'→'3' 으로 올린다 — 이는 수치 버전 저장이 아니라 기존 메타 필드이며 새 컬럼이 아니다.

### 구현 범위
1. RR 검출 입력 영위상 필터(가장자리 홀대칭 패딩 100샘플), 창 끝 50샘플(1초) 안 닫는 피크 RR 확정 보류, 포물선 보간 — TS(`PPGSignalProcessor.ts`) + Rust(`dsp/ppg.rs`·`dsp/biquad.rs`) 동시. HR·SQI·SpO2 입력 필터는 유지.
2. 골든 픽스처 재생성(`expected/oracle`, `expected/legacy_fallback`, `expected/gf04`) + manifest 재생성.
3. 저장값 재산출 스크립트 `backend/scripts/` (기본 dry-run, `--apply`, `--rollback`).
4. 리포트 문구(변화량 임계) 스케일 점검, 리포트 재생성 필요 판정 방법 문서화.
5. (선택 4번 지터 플래그)는 저장 컬럼 없이 넣을 경로가 없어 **생략**.

### 추가 합격 기준
- V1(하네스 53명): RMSSD 중앙 30~45ms, 재계산과 ρ≥0.9, HR 중앙 절대차 ≤1.5, 사람별 비(서비스/재계산) 0.9~1.15, SDNN/RMSSD — 정상 범위(대다수 RMSSD≤SDNN). 1초·0.5초 간격 둘 다.
- V2(합성): `frontend/tests/fix-rmssd-zero-phase.test.ts` — 목표 RMSSD 15/40/80ms 편향 ±5ms(또는 ±12%), HR ±1, 호흡성 변조 신호에서 RMSSD/SDNN 비 ≤1.
- V3(경계): 창 끝 보류 박동이 다음 창에서 정확히 1회 확정(AnalysisMetricsService 커서 정합), 30초 미만 rmssd null 유지, `sdd244-*`·`sdd246-web`·`sdd273`·`fix-ppg*` 무회귀.
- V4(TS↔Rust): `cargo test` 전체 통과(골든 재생성 후 `golden_oracle`·`golden_acc_gf04`·`sdd314_hrv_gates`·`sdd316_not_worn`·`engine_invariants`), `check-contracts.sh` 6단계 중 oracle(biquad/legacy) 통과, manifest check OK.
- V6'(재산출 도구, 로컬 SQLite/PG 시험): ① dry-run 은 DB 변경 0행 ② apply 는 회차 단위 트랜잭션·원래값 JSON 백업 생성 ③ rollback 은 원래값 정확 복원 ④ 재실행 멱등(2회차 apply 변경 0행) ⑤ 원시 없는 회차는 건드리지 않고 건수만 집계 ⑥ production 환경에서 `--confirm-production` 없으면 apply 거부 ⑦ 새 컬럼/테이블/마이그레이션 0 (`git diff -- backend/alembic` 비어 있음) ⑧ 롤업 `*_mean` 도 같은 행 UPDATE.
- V5'(리포트 문구): SDNN 변화량 임계(±5ms)가 새 스케일(SDNN 중앙 ~52→~36)에서 의미 있는지 하네스 값 분포로 검토, 바꿀 때 근거 기록. 점수화 금지 원칙 유지.
