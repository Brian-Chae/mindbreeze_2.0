# SDD-296 — 정원 늘리기 입력 검증 오류 수정

- 브랜치: `sdd/296-capacity-form-stale-current` / 작성일: 2026-11-05

## 증상
라이브 설정 시트에서 정원을 20으로 늘리면 서버는 성공(`class_capacity_events` 10→20, 20→30 성공 기록)인데,
화면에는 "현재 정원(N명)보다 큰 숫자를 입력해 주세요"가 뜬다(30 입력도 동일).

## 확정 원인 (코드 추적)
- `CapacityIncreaseForm` 의 입력 상태 `raw` 는 마운트 시 `current+1` 로 한 번만 초기화되고, 이후 `current` 가 바뀌어도 재동기화하지 않는다.
- 성공 → `onChanged(next)` → 부모가 `current=next` 로 갱신 → `raw`(방금 입력한 20) `<= current`(20) → `not_increase` 오류가 즉시 표시되고,
  `errorText = inputMessage || serverError` 우선순위라 성공 안내(`done`)도 가려진다.
- `HostCapacityProps.capacity` 출처는 `GET /classes/{id}` 의 `capacity`(서버 클래스 정원)로 정상. 입장 인원(joined)이 정원으로 들어가지 않음(`HostSettingsSheet` 가 별도 prop 으로 분리).
- "현재 정원 1명" 표시는 코드상 재현되지 않음(정원=서버 값). 같은 시트의 '현재 입장 1명'과의 혼동 가능성 — 확인 못 함.

## 범위
- 포함: 성공 후 입력 기본값을 새 정원+1 로 재설정, 외부에서 `current` 가 바뀌면 입력 재동기화, 성공 안내가 검증 오류에 가려지지 않게 함, 문구 정리.
- 제외: 정원 늘리기 위치 이동(SDD-299), 서버 변경.
