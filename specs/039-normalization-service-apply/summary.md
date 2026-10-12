# SDD-039 Summary — 표준 모델 정규화 실제 서비스 적용

## 원인
- playground만 `band.scoredIndices`(정규화) 사용, 실제 서비스는 `band.currentEfficiency`(raw relaxationIndex 0~1) 사용
- SDD-037에서 relaxationIndex가 raw(α/(α+β))로 바뀌면서, % 표시 화면에서 두뇌휴식도가 0~1로 표시

## 수정
- `useBand` 두 경로(metrics 업데이트 + WS feature 수신)에서:
  - raw indices 저장 후 `toScoredIndices(raw)`로 정규화
  - `currentEfficiency`/`focusIndex`/`stressIndex`를 정규화된 0~100 값으로 설정
- 업로드 payload의 `relaxation_index`는 raw 유지 (백엔드 저장 기준)

## 결과
- 실제 서비스(상담사/회원) 두뇌휴식도가 표준 모델 정규화된 0~100 값으로 표시
- 표준 모델이 playground + 실제 서비스 양쪽에 일관 적용

## 검증·배포
- `npm run build` 0 error
- 커밋 `61238d2` → Deploy Dev `34816374479` 성공
