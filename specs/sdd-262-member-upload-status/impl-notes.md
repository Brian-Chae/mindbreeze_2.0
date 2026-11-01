# SDD-262 impl-notes

- 서버 변경 없음. 회차 목록 = `GET /classes` + `GET /classes/{id}/sessions`(회원 본인 `attendance` 병합 필드), 데이터 = `features/summary`·`biosignal-raw/summary`(participant_id 미전달 → JWT 본인).
- 달라진 점: summary 엔드포인트에 ETag/304 가 없어 SDD-261 `useUploadStatus` 를 재사용하지 않고 전용 훅 `use-my-upload-status.ts`(진행 중 5초 폴링) 작성. SDD-261 코드 수정 0.
- 상태 4종(확인 필요/업로드 중/수신 확인/수신 기록 없음). 미착용은 summary 로 구분 불가 → '수신 기록 없음(미착용·마이크 OFF 면 정상)'으로 표기.
- 회차 후보: attendance 있는 in_progress/open/completed 만. 회원이 본 회차라도 입장하지 않았으면 summary 가 0 으로 나올 수 있음.
- 워크트리 node_modules 는 메인 체크아웃 것을 심링크(미커밋).
- 미확인: dev 서버 실응답·실기기 390px 캡처(jsdom 단위 검증만).
