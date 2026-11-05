# SDD-296 summary

- 원인: `CapacityIncreaseForm` 입력 상태 `raw` 가 최초 `current+1` 로만 초기화됨. 성공 후 부모가 `current=20` 으로 갱신하면 `raw`(방금 낸 20) `<= current` 가 되어 `not_increase` 오류가 즉시 뜨고, 오류가 성공 안내보다 우선 표시됨. 서버는 정상.
- 수정: ① 성공 시 입력을 새 정원+1 로 재설정 ② `current` 변경 시 낡은 입력(≤current)만 재동기화(더 큰 편집 값은 보존) ③ 같은 값 문구에 "변경되지 않음" 명시(서버 `new==old` 는 no-op 이라 클라이언트는 계속 막음).
- 시험: capacity-increase-form 11건(신규 5: V1·V2, V3, V4, V4b, V5; RED 3 → GREEN), capacity-increase, host-settings-dock 포함 3파일 21건 통과, `tsc -b` 0.
- 미확인: 실기기 "현재 정원 1명" 표시는 코드상 재현 안 됨(정원=서버 클래스 정원, 입장 인원은 별도 행). 같은 시트 '현재 입장 1명'과의 혼동 추정. 전체 vitest 는 시간 초과로 미실행.
- 앱 재빌드: 웹 코드만 변경 → 웹 배포로 반영(네이티브 재빌드 불필요 추정, 캡 번들 포함 여부는 감독 확인).
