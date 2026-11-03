# SDD-278 Verify (구현 전 작성)

| ID | 시나리오 | 기대 | 시험 |
|---|---|---|---|
| V1 | 종료 후 23h59m59s, 폰 보고 없음, 데이터 있음 | 의심 false | be sdd278/logic |
| V2 | 정확히 24h / 24h+ | 의심 true, state=expected_unknown 유지 | 〃 |
| V3 | 종료 시각 없음 / 회차 미종료 | false | 〃 |
| V4 | 보고 있음 + final | false (all_received 등 기존) | 〃 |
| V5 | 보고 있음 + final 아님 + raw 기대 null(expected_unknown) | true | 〃 |
| V6 | 보고 있음 + final 아님 + 종료 30분 미만(in_progress) / 보고 있음 + final + raw 일부 null | false | 〃 |
| V7 | 수집 제외 + 데이터 없음 / 데이터 없음(미제외) | false (not_collected / 기존) | 〃 |
| V8 | 수집 제외 + 데이터 있음 + 보고 없음 | true | 〃 |
| V9 | aggregate: 의심 인원 수, 수치 합에서 제외, merge 합산 | | 〃 |
| V10 | `abnormal_after_sec` 오버라이드(60초) | 60초 경계 적용 | 〃 |
| V11 | 상세·개요·회원 응답 기존 키 불변(추가만), 구 필드 값 동일 | | be sdd278/api |
| V12 | 상세 API: 비회원 보고 없음 25h → participants[].progress.abnormal_exit_suspected true, 합계 1 | | 〃 |
| V13 | 새 필드 응답 JSON 을 구버전 파서(고정 사본)가 파싱 → state==='expected_unknown' | | fe sdd278/compat |
| V14 | 새 필드 없는 구서버 응답을 새 파서가 처리 → false/0 | | 〃 |
| V15 | 코치 화면: "비정상 종료 의심 N명" 줄·설명, 확인할 사람 수 미포함, 접힌 목록, 금지어 없음 | | fe sdd278/screens |
| V16 | 회귀 | pytest sdd263·264·267·271, vitest sdd264·265·267·upload-*, tsc -b, eslint, ruff | 전체 |
