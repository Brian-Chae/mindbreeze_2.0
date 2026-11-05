# SDD-296 plan

1. `CapacityIncreaseForm`: `current`/`max` 변경 시 `raw` 를 `min(current+1,max)` 로 재동기화(사용자가 `current` 이하를 쓴 stale 입력일 때만 — 정상 편집 중 입력은 보존). 성공 시 `setRaw(String(min(next+1,max)))`.
2. 성공 안내(`done`)가 있으면 입력 오류보다 우선 표시되지 않게: 성공 직후에는 raw 가 새 기본값이므로 오류가 없다 → 안내 노출.
3. `capacity-increase.ts`: 클라이언트는 서버보다 엄격하지 않아야 하나, `new == old` 는 서버에서 `changed:false` no-op 이라 "늘렸어요" 안내가 거짓이 된다. 따라서 `==` 는 클라이언트에서 계속 막되 문구를 "현재 정원(N명)보다 커야 해요(같은 값은 변경 없음)"로 맞춘다. `< old` 는 서버와 동일하게 거절.
4. 시험(RED→GREEN): 폼 시험에 10→20 성공 후 current=20 rerender → 오류 없음·입력값 21·30 제출 가능, 입장 인원이 정원으로 쓰이지 않음(시트 시험).
5. 회귀: tsc -b, vitest(capacity*, sdd289*).
