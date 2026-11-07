# SDD-317 verify addendum 10 — 4단계 홀드아웃 1회 평가 사전등록 (홀드아웃 열기 **전** 커밋, 사후 변경 금지)

작성: 2026-11-07, 대표 승인("Brian Chae 11/7 대화 승인") 후, 홀드아웃(MARSH 14명·CapnoBase 42건)의 신호·참값을 알고리즘에 먹이기 **전**.
addendum-8·9 의 판정·통계 규칙은 그대로 유효하다. 바꿔야 하면 `verify-addendum-11.md` 로 추가하고 이 파일과 이미 낸 결과는 남긴다.
홀드아웃 결과를 본 뒤 알고리즘·임계·후보를 고쳐 다시 재는 것은 금지다(그 경우 '검증'이라 부를 수 없다). 버그가 발견되면 고치지 않고 그대로 보고하며, 수정·재실행은 대표 판단이다.

## A10-0. 확정 후보 (추가·변경 금지)
| ID | 내용 | 구현 |
|---|---|---|
| C0 | 현행 코어 (V0 거울 = 코어, 개발 세트에서 동치 확인) | 거울 `V0` (파라미터 없음) |
| W4a | 호흡 스펙트럼 전 4Hz 재표본의 평균(DC) 제거만 | `detrend=mean` |
| W2a | RR 정제 허용폭 ±25% → ±30% (후보 게이트·소급 정리·재시드 시드 3곳) | `refine=pm30` |

- W5(=V4+W3)는 W3 가 박동·HRV 를 악화시켜 제외. 다른 조합 없음. 후보 3개는 **동시에 한 번** 평가한다.

## A10-1. 대상·데이터
- MARSH 홀드아웃 14명: `splits.json` 의 `holdout.marsh` 그대로(변경 금지). CapnoBase 42건(300Hz, 8분, CSV).
- 신호 변환·패킷화·극성·IR 스케일은 개발 세트와 동일한 기존 하네스(`convert.prepare`)를 그대로 쓴다. 50Hz 변환 `resample_poly`.
- **CapnoBase 참값**: `labels.co2_startinsp_x`(CO₂ 흡기 시작 샘플 인덱스) ÷ 300 = 호흡 이벤트 시각. 이 이벤트열에서 개발 세트와 동일한 `window_rate`(창 내 이벤트 ≥3, 경계 간격 ≤1.5×중앙 간격) 규칙으로 창 호흡수를 만든다. 박동 참값은 `labels.ecg_peak_x`(사람 평가자 R-peak) ÷ 300. CO₂ 흡기 시작 정의는 호흡 이벤트의 단일 열 규칙(MARSH 와 같은 처리)이며 열기 전에 고정한다. 아티팩트 구간 표기(`*_artif_x`)는 제외하지 않는다(개발 세트도 구간 제외 안 함).
- 참값 인덱스 ≤0 은 MATLAB 빈칸 패딩으로 보고 제거한다(스키마 시험에서 기록 0133 의 흡기 시작 열에 0 이 6개 있음을 확인; 알고리즘 결과와 무관). 인덱스는 변환 없이 ÷300 한다(1-기반 보정 3.3ms 는 적용하지 않음, 개발 세트 MARSH 와 같은 처리).
- **CapnoBase 성인/소아 구분(메타데이터 `subject_age` 기준, 열기 전 고정)**: 나이 ≥18 = 성인, <18 = 소아, 미기재 = 미상(성인/소아 표에서 제외, 전체에는 포함).
- 로더 스키마 검증은 신호 형식·샘플 수·참값 파싱만 확인했다(알고리즘 결과는 보지 않음). 로더 확인 중 본 것은 기록 ID·나이·환기 방식·샘플 수·토큰 개수뿐이다.
- 인용·약관: CapnoBase = Karlen W, Raman S, Ansermino JM, Dumont GA. *Multiparameter respiratory rate estimation from the photoplethysmogram.* IEEE Trans Biomed Eng 2013;60(7):1946–53, DOI 10.1109/TBME.2013.2246160. 연구용 자유 사용 조건, 재식별 금지.

## A10-2. 지표 (2단계와 동일 + 박동 변형)
- 호흡: coverage, MAE, 중앙AE, bias, LoA, p95, MAE_pen(null 12회/분 패널티), 첫 유효값 지연·점프(진단).
- 박동·HRV(A9-4 와 동일, 판정 아님): HR_rr(=60000/AVNN) MAE, SDNN·RMSSD bias(%·절대)·MAE, 버퍼 숙성 박동 F1(±100ms, 30초 블록 지연 보정). 신뢰 기록 게이트(addendum-6·7)를 홀드아웃에도 같은 규칙으로 적용한다(MARSH: R-peak F1≥0.98; CapnoBase: 사람 평가자 R-peak 대비 검출 F1≥0.98 — 같은 `record_quality` 규칙).
- 창: **L=60s 주 결과**, 30s·120s 는 민감도(채점창만 바꾸고 코어 출력은 동일). 채점 hop 10s.

## A10-3. 판정 규칙 (addendum-8 A8-4 와 동일, 변경 없음)
후보 W4a·W2a 를 C0(V0) 와 비교한다(판정 대상 2건 → "판정 2건 중 개선 n건").
- (a) 풀링 MAE 쌍체 95% CI(기록 단위 cluster bootstrap, B=2000, 시드 317, 후보·C0 같은 재표본) 상한 <0 (또는 독립 CI 비중첩+낮음)
- (b) coverage 감소 ≤5%p (풀링, 데이터셋별 MARSH·CapnoBase)
- (c) 판정 층(<6, 6–12, 12–20, >20, **기존 그대로**) 중 n_rec≥10 칸에서 MAE 점추정 Δ≤0; n_rec<10 칸은 해석불가로 표기·제외
- (d) MAE_pen 쌍체 CI 하한 >0 이면 "개선 아님 (MAE_pen 악화)"
- Holm 보정(m=2, 풀링 ΔMAE 양측 부트스트랩 p), Bonferroni CI(수준 1−0.05/2) 병기 — 참고용이며 판정은 위 규칙으로만 한다.
- 모두 만족 → 개선, 아니면 개선 아님. "개선"이라도 코어 반영 후보일 뿐 코어는 수정하지 않는다. 인과 단정·'정확도 보증' 표현 금지.
- 게이트: G-resp(C0 거울 == 코어 `resp`, 홀드아웃 기록 전체, 전체 ≤0.1%·기록별 ≤1%), G-hrv(C0 SDNN·RMSSD == 코어). G-resp 실패면 모든 수치를 해석 불가로 표시한다(수정·재실행 안 함). G-front 는 이번 후보가 코어 RR 을 그대로 쓰므로 판정에 필요 없다(참고 출력).

## A10-4. 보고 방식
- 데이터셋별(MARSH 홀드아웃 / CapnoBase) 과 통합(풀링), CapnoBase 성인·소아 별도.
- **보고용 층 6개**: <6, 6–8, 8–10, 10–12, 12–20, >20 (열린 하한/상한은 [lo, hi)). 판정에 쓰는 층은 위 (c) 의 기존 4층 그대로다.
- 느린 호흡 층(6–8/8–10/10–12) 별도 표, 개발 세트 대비 일관성(같은 방향인지)은 `holdout-summary.md` 에 쓴다.
- 한계: 손가락·귀 PPG ≠ 이마 반사형, CapnoBase 소아 다수 포함(28/42 예상), 다중성(개발 세트 판정 포함 시 후보 선택 효과), 호흡 참값 정의가 데이터셋마다 다름(MARSH 임피던스 정점 vs CapnoBase CO₂ 흡기 시작).

## A10-5. 코드 동결·잠금 해제
1. 동결 커밋 F: 이 문서, `experiments.json`(`phase4_holdout`), 해제 코드(`guard.py`), 실행기(`holdout.py`), CapnoBase 로더, 시험을 포함. **F 이후 `tools/ppg-eval` 평가 코드 변경 금지.**
2. 승인 커밋 A (F 바로 뒤): `holdout-approval.json`(승인자 "Brian Chae 11/7 대화 승인", 후보 3개, 동결 SHA=F)과 `experiments.json` 의 `phase4_holdout.freeze`(F 의 SHA·`ppg_eval`·`tools/ppg-eval`·코어 `src` 트리 해시) 기록만 추가. 자기 SHA 를 담을 수 없으므로 F/A 두 커밋으로 나눈다.
3. `run-holdout --unlock-token <승인 파일 sha256> --confirm-single-run` 은 다음이 모두 참일 때만 열린다: (a) 승인 파일이 커밋돼 있고 내용·토큰 일치 (b) 동결 SHA 가 HEAD 의 조상이며 이후 변경이 승인 파일·`experiments.json`·접근 로그뿐 (c) `ppg_eval`·`tests`·`splits.json`·코어 `src` 트리 해시가 F 와 동일 (d) 작업 트리 변경 없음 (e) 실행 기록 `results/holdout/run-record.json` 없음.
4. 실행 기록은 처리 시작 **전에** 쓴다 → 중간에 실패해도 재실행은 거부된다.
5. 접근 로그: 개발 세트 로그 `results/access-log.jsonl` 의 마지막 항목은 홀드아웃 접근 이전이고, 홀드아웃 접근은 `results/holdout/access-log-holdout.jsonl` 에만 기록된다. 동결 커밋 시각은 그 파일의 첫 항목보다 앞서야 한다(보고서에 둘 다 표기).
6. 푸시·PR·배포·메일·삭제·운영/dev DB 접근 금지, 로컬 커밋만.
