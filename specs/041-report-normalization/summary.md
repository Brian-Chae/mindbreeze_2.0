# SDD-041 Summary — 리포트 표준 모델 정규화 적용

## 분석 결과 (데이터 흐름 정합성)
- ① 화면(프론트): scoredIndices = 표준 모델 sigmoid > 코호트 B0 fallback ✅
- ② 클래스 저장: 1초 feature raw 값 저장 (정상)
- ③ 백엔드 리포트: 정적 코호트 상수(normalization_constants.json)만 사용 ❌ (표준 모델 미적용)

## 구현 결과
- `app/services/normalization_score.py` — 프론트 eegSigmoidScore 수식 동일 이식 (transformRaw/sigmoidScore/faa 편차형)
- `eeg_metrics.compute_session_metrics` — normalization_params 파라미터 추가, 있으면 sigmoid 적용 + normalization_source="standard_model"
- `report_task.py` — 활성 표준 모델(NormalizationModel.is_active) 조회 → params 전달
- 표준 모델 없으면 기존 코호트 상수 fallback

## 수정 보완 (워커 부분 완료 1건)
- report_task.py에서 활성 표준 모델 조회·전달 누락 → 직접 추가

## 검증·배포
- BE pytest 386 passed (신규 normalization_score 36건 포함)
- 커밋 `e2f8a8d` → Deploy Dev `34822230799` 성공
