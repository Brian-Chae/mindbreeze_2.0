# SDD-022 — Verify (구현 전 QA 게이트)

> 구현 전에만 작성. 아래 시나리오를 구현 후 실제 테스트로 검증한다.

## 1. 지표 산출 정합 (eeg_metrics.py)
- [ ] focus_index_stability / total_neural_activity / cognitive_load_stability / stress / hemispheric_balance / emotional_stability / relaxation 7종 산출
- [ ] null 입력 → null 반환 (0 치환 금지)
- [ ] weighted_total: null 지표 가중치 재정규화
- [ ] evaluate_session_quality: insufficient(TOO_SHORT) / invalid(LOW_QUALITY) / degraded / valid 4상태
- [ ] 정규화 상수 JSON 로드, version 추적

## 2. content 스키마 정합
- [ ] UI 기대 필드: summary / insights[] / markers[{label,value}] / eeg_summary / eeg_timeline
- [ ] 생성기 산출 content.eeg: status / reliability / drowsiness_flag / score / metrics / timeline
- [ ] 두 계약이 단일 어댑터로 매핑, 빈 섹션 없음

## 3. 품질 게이트 노출
- [ ] valid → 종합점수 + 7지표 + 타임라인
- [ ] degraded → 포함 + 배지
- [ ] invalid/insufficient → 종합점수·레이더 숨김 + 사유
- [ ] not_measured(미착용) → EEG 섹션 DOM 미노출

## 4. 두뇌휴식도 매핑
- [ ] 내담자 라벨 "두뇌휴식도" 값 = relaxation_score

## 5. counselor/client 비대칭
- [ ] 상담사: 7지표 전체 + null 사유 + reliability 수치
- [ ] 내담자: 상위 3~4지표 + 쉬운 라벨 + 나머지 접힘

## 6. null 보존
- [ ] report_task.py에 `or 0`/`or {}` 치환 잔존 없음

## 7. 회귀
- [ ] 백엔드 pytest 전체 통과 (기존 + 신규)
- [ ] 프론트 tsc 0 error + build 통과
- [ ] 미착용 세션에서 기존 상담 리포트 정상 동작
