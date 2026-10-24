# 요약 — 데이터 센터 다운로드 재인증 제거·동의 판정·안내 문구

## 원인
- 다운로드 비활성: 미리보기·재검사가 옛 필드 `consent_eeg`(기본 False)만 봄 — `data_center_export.py:199`, `:370`, `data_center_governance.py:82-90`, `data_center_query.py:662·765`, `data_center_runtime.py:175`, `export_service.py:78·108·137·206·224`, `class_report_trend_service.py:184`. 실제 입장 동의는 `eeg_collection_consented`에 기록되므로 데이터가 있어도 `consent_missing` → `no_eligible_targets`.
- 재인증: 작업 생성·URL 발급 두 곳이 `export_reauth.verify_export_proof`로 proof를 강제.

## 바뀐 동작
- 동의 판정 단일 함수 `recording_consent_service.eeg_export_consented`(+SQL `eeg_export_consent_clause`): False 제외 / True 허용 / NULL은 `consent_eeg` 또는 실제 측정 보유로 허용(업로드 규칙 `assert_eeg_upload_allowed`와 동일 근거). 연구(ResearchConsent)는 그대로 추가 조건.
- 스위치 `data_center_export_reauth_required`(기본 False): 꺼짐이면 proof 없이 작업 생성·URL 발급, 사유·감사·범위 재검사·60초 링크·24시간 산출물·가명 기본 유지. 켜면 기존 SDD-243(비밀번호·소셜 #91) 그대로. `/contexts`의 `limits.reauth_required`로 프론트 분기, policy_hash에 포함.
- 프론트: 재인증 UI는 스위치 켜짐일 때만. 문구는 `lib/data-center-labels.ts`로 일반 한국어 매핑(대화상자·작업 목록·감사·측정 상세·분석 값 표).
- 흐름: ①항목 선택 → ②사유 → ③'다운로드할 데이터 확인' → ④'다운로드 작업 생성', 비활성 버튼엔 이유 한 줄.

## 테스트
- pytest 전체 4299 통과·505 skip(실패 0, -x 없음). 신규 `test_fix_dc_download_ux.py` 8건(RED 8 실패 → GREEN).
- 기존 테스트 조정: 철회를 `consent_eeg=False`로 흉내 내던 곳은 실제 철회 경로(`eeg_collection_consented=False`)로, 재인증 검증 테스트는 스위치 켠 상태로.
- vitest 전체: 17건 실패는 기존 8파일·17건과 동일(agent-counselor-page, chat-message-deeplink, org-*-browser, report-*-pdf, sdd220-native-release, sdd234-a-mobile-home). 신규 `dc-download-ux.test.tsx` 6건 + 관련 45건 통과.
- tsc·eslint src/·build 통과. 캡처: `dialog-1440-{excluded,clean,empty}.png`.

## 남긴 것
- `data-center-metadata-table.tsx`(동의·보관 현황 표)의 일부 상태 코드(export_state, 연구 반출 batch status 등)는 의미 확정 전이라 이번에 매핑하지 않음.
- 개발 환경 jsonschema 누락(PYTHONPATH 경로 부재)은 /tmp 설치본으로 대체해 계약 테스트 통과 확인.
