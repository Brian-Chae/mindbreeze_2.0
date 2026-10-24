# 구현 전 검증 체크리스트 — 데이터 센터 다운로드 재인증 제거·동의 판정·안내 문구

## 원인 분석
- [결정 1] 대표 지시: 다운로드 직전 비밀번호 재인증 제거. 사유·감사·권한/기관 범위 재검사·링크 60초·산출물 24시간·가명 기본은 유지.
  서버 `export_reauth.verify_export_proof`가 `data_center_export.py`의 작업 생성(create_data_center_export)과 URL 발급(issue_part_url) 두 곳에서 proof를 강제.
- [결함 2] 1회차·참여 1명·측정 1건인데 미리보기가 `consent_missing`으로 전부 제외.
  `data_center_export.py:199`(preview), `:370`(_revalidate_targets), `data_center_governance.py:82-90`(동의 현황), `data_center_query.py:662`(측정 목록)·`:765`(측정 상세), `data_center_runtime.py:175`(파일별 재확인),
  `export_service.py:78,108,137,206,224`(단건 반출), `class_report_trend_service.py:184`가 모두 옛 필드 `SessionParticipant.consent_eeg`(default False)만 본다.
  실제 회차 입장 동의는 `recording_consent_service.apply_eeg_choice`가 `eeg_collection_consented`에 기록하고 `consent_eeg`는 거의 채워지지 않는다(session_service 2164·2226 일부만 True).
- 업로드 허용 규칙 `assert_eeg_upload_allowed`: `eeg_collection_consented is False`면 차단, NULL(기능 이전 행)은 기존 동작 유지(허용).

## 판정 규칙(단일 함수 `eeg_export_consented`, SQL 대응 `eeg_export_consent_clause`)
| eeg_collection_consented | 판정 | 근거 |
|---|---|---|
| False | 제외 | 명시 거부. 업로드 규칙과 동일 |
| True | 허용 | 입장 시 동의 기록 |
| NULL | consent_eeg True 이거나 실제 측정 데이터가 있으면 허용 | 기능 이전 행 호환. 업로드가 NULL을 허용했으므로 저장된 데이터가 있다는 것 자체가 당시 수집 허용의 증거 |
- 연구 목적(ResearchConsent) 판정은 그대로 추가 조건으로 유지.

## 백엔드
- [ ] 입장 동의(eeg_collection_consented=True)만 있고 consent_eeg=False인 참여자 → 미리보기에 포함
- [ ] eeg_collection_consented=False(명시 거부) → consent_missing 제외 (consent_eeg=True여도 제외)
- [ ] NULL + consent_eeg=False + 측정 데이터 있음 → 포함 / NULL + 데이터 없음 + consent_eeg=False → 제외
- [ ] 작업 생성 후 URL 발급 시 `_revalidate_targets`도 같은 규칙(입장 동의만 있어도 통과, 거부로 바뀌면 access_revoked)
- [ ] 동의 현황(governance)·측정 목록/상세 consent 표시가 같은 규칙
- [ ] 연구 목적: 입장 동의 + ResearchConsent 둘 다 필요(회귀)
- [ ] 스위치 `data_center_export_reauth_required` 기본 False: reauth_proof 없이 작업 생성·URL 발급 성공, 사유·감사·범위 재검사는 그대로(사유 누락 422, 타기관 404)
- [ ] 스위치 True: 기존대로 proof 없으면 403 reauth_required, 잘못된 proof 403 reauth_invalid, 검증기 없으면 reauth_unavailable
- [ ] `/data-center/context`의 limits.reauth_required가 스위치를 반영, policy_hash에 포함
- [ ] 타 기관 참여자/회차는 여전히 404·범위 밖(회귀)
- [ ] `/export-reauth`·소셜 재인증(#91) 코드·테스트 그대로 동작(삭제 없음)
- [ ] 백엔드 전체 pytest(-x 없이)

## 프론트
- [ ] 스위치 꺼짐(reauth_required=false): 대화상자·작업 목록에 비밀번호·'재인증 요청'·'반출 전용 재인증' 문구가 없음, 재인증 API 호출 없음
- [ ] 스위치 켜짐: 기존 재인증 UI 그대로
- [ ] 흐름 ①항목 선택 ②사유 입력 ③'다운로드할 데이터 확인' ④'다운로드 작업 생성', 비활성 버튼 아래 이유 한 줄
- [ ] 결과 'N회차 · N명 포함, N건 제외' + 제외 사유 한국어(모든 사유 코드), no_eligible_targets → '내려받을 수 있는 데이터가 없습니다 (사유: …)'
- [ ] 예상 크기 모르면 숨김/'예상 크기 계산 중', 정책 버전 코드 숨김, '제외 범위를 확인했습니다'는 제외가 있을 때만
- [ ] 개발자 문구 제거(범위 미리보기, manifest, feature, bin·청크, 링크 발급 증거 등), 데이터 센터 전 화면 내부 코드 노출 grep 정리
- [ ] #92 스타일 유지, 1440 캡처 2종(제외 있음/없음)
- [ ] vitest 관련+전체(기존 8파일·17건 대조), tsc, eslint src/, build
