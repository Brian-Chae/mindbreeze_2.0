# 시안 인덱스 (R0 확정 — R4/R5 정합화)

> 자동 생성: `designs/class-flow-redesign/tools/r0-build.mjs` · 정본 키 목록 `designs/class-flow-redesign/case-keys.json` · 확정 케이스 수 **232** (회원 106 · 상담사 126). 구현 하니스 `?index=1` 은 이 표와 키가 일치해야 한다(verify G1).

=== member-a (36)

| 화면 | 케이스 수 | 케이스 키 |
|---|---|---|
| FM01 | 5 | `upcoming` `soon` `open` `live` `empty` |
| FM02 | 3 | `list` `invited` `apply` |
| FM03 | 7 | `scheduled` `scheduled-offline` `open` `open-offline` `open-1on1` `done` `cancelled` |
| FM04 | 6 | `default` `filled` `leading-zero` `error` `throttled` `member` |
| FM04b | 5 | `default` `filled` `error` `mismatch` `member` |
| FM05 | 4 | `member` `guest-name` `member-wait` `member-offline` |
| FM10 | 6 | `cancelled` `closed` `notyet` `error` `offline` `entry-expired` |

=== member-b (70)

| 화면 | 케이스 수 | 케이스 키 |
|---|---|---|
| FM06a | 9 | `on-group-opt-member` `on-group-req-member` `on-solo-none-member` `off-group-none-member` `off-solo-opt-member` `on-group-opt-member-empty` `on-group-opt-member-included` `on-group-opt-member-research-agree` `on-group-opt-member-research-fail` |
| FM06b | 8 | `on-group-opt-member-q1` `on-group-opt-member-q2` `on-group-opt-member-q3` `on-group-opt-member-q4` `off-group-none-member-q1` `on-solo-req-member-q4` `on-group-opt-member-q2-started` `off-group-none-member-q1-started` |
| FM06c | 15 | `on-group-opt-member-idle` `on-group-opt-member-connecting` `on-group-opt-member-connected` `on-group-opt-member-leadoffl` `on-group-opt-member-leadoffr` `on-group-opt-member-leadoff` `on-group-opt-member-unsupported` `on-group-req-member-idle` `on-group-req-member-leadoffl` `on-group-req-member-leadoff` `on-group-req-member-unsupported` `on-group-req-member-connected` `off-solo-opt-member-idle` `off-group-req-member-connected` `on-group-opt-member-idle-started` |
| FM06d | 13 | `on-group-opt-member-mic` `on-group-opt-member-camon` `on-group-opt-member-micdenied` `on-group-opt-member-micnodev` `on-group-opt-member-camdenied` `on-group-opt-member-unsupported` `on-group-opt-member-micdenied-sheet` `on-group-opt-member-camon-micdenied` `on-solo-req-member-camon-spk` `on-solo-none-member-mic` `on-group-opt-member-camon-quiet` `on-group-opt-member-camon-started` `on-group-opt-member-mic-started` |
| FM06e | 6 | `on-group-opt-member` `on-group-req-member` `on-solo-none-member-skip` `off-group-none-member` `off-solo-opt-member-noband` `on-group-opt-member-nomic` |
| FM07 | 6 | `on-group-opt-member` `on-group-opt-member-bgmoff` `on-solo-none-member` `off-group-none-member` `off-solo-opt-member` `on-group-req-member` |
| FM08 | 4 | `on-group-member` `on-solo-member` `off-group-member` `on-group-member-cancel-sheet` |
| FM09 | 9 | `on-group-member` `off-solo-member` `on-group-member-checked` `on-group-member-report` `on-group-member-reportsent` `on-group-member-checkin` `on-group-member-checkinempty` `on-group-member-excluded` `on-group-member-guest-report` |

=== host-a (49)

| 화면 | 케이스 수 | 케이스 키 |
|---|---|---|
| FH01 | 7 | `open` `open-offline` `progress` `idle` `empty` `past` `net` |
| FH02a | 7 | `online-group` `online-1to1` `offline-group` `offline-1to1` `online-group-max` `custom` `leave` |
| FH02b | 4 | `none` `optional` `required` `offline` |
| FH02c | 4 | `now` `later` `conflict` `long` |
| FH02d | 5 | `empty` `picked` `solo` `search` `email` |
| FH02e | 2 | `online` `offline` |
| FH03 | 7 | `online` `offline` `partial` `scheduled` `none` `email` `email-partial` |
| FH04 | 13 | `ready` `scheduled` `open` `progress` `completed` `cancelled` `offline` `menu` `cancel` `close` `delete` `net` `email-invites` |

=== host-b (77)

| 화면 | 케이스 수 | 케이스 키 |
|---|---|---|
| FH05 | 10 | `ok` `quiet` `cam-off` `mic-off` `mic-off-warn` `mic-denied` `cam-denied` `nodevice` `unsupported` `offline` |
| FH06 | 25 | `g-on-0` `g-on-3` `g-on-8` `g-on-12` `g-off-0` `g-off-3` `g-off-8` `g-off-12` `o-on-0` `o-on-1` `o-on-1r` `o-off-0` `o-off-1` `o-off-1r` `g-on-3-req` `g-off-3-none` `o-off-1r-none` `g-on-8-none` `g-on-0-inv0` `g-off-0-inv0` `g-on-3-wait` `g-off-3-wait` `g-on-12-many` `g-on-3-contact` `g-on-8-contact` |
| FH06a | 11 | `invite` `invite-all` `bgm` `band` `band-on` `band-bad-l` `band-bad-r` `band-bad-lr` `speak` `chat` `chat-off` |
| FH07 | 12 | `ok` `pending` `all-wait` `many-wait` `mic-off` `no-consent` `offline` `one` `one-wait` `empty-wait` `empty-wait-offline` `empty-wait-one` |
| FH08 | 3 | `choose` `choose-0` `confirm` |
| FH09 | 9 | `confirm` `confirm-busy` `end-saving` `end-stt` `end-ai` `end-done` `manual-ing` `manual-done` `excluded-common` |
| FH10 | 7 | `closed` `closed-0` `closed-revisit` `error` `error-notfound` `error-forbidden` `error-network` |
