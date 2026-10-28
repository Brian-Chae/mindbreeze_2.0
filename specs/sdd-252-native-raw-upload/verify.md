# SDD-252 — Verify (구현 전)

## Test Scenarios
- TS1 (Android) RawChunker: EEG 250Hz 패킷 N개 → 10초(2500샘플) 도달 시 청크 1개. 기대: 헤더 `sample_count=2500`, `end-first=count`, `sections` 3개(offset 연속, samples 길이 = stride×count), 크기 ≤ 1MiB, 서버 `RawHeader` 검증 통과 JSON(`scale` 은 float 표기).
- TS2 PPG/ACC 도 같은 규칙(stride 8/18, 인코딩명 일치). ACC rate 30.
- TS3 tick 불연속(감소, 비-wrap) 또는 단조시계 대비 >1s 편차 → 새 segment, 이전 segment 부분 청크 봉인.
- TS4 정상 간격 반복(PPG 불규칙 tick 포함 ±수십 ms) → segment 쪼개짐 없음.
- TS5 malformed 패킷(길이 불일치) → 샘플 0, `malformed_reason='truncated_packet'`, 바이트 보존, 샘플 index 위조 없음.
- TS6 flush(정지) → 남은 샘플 봉인. 샘플 0 이면 청크 없음.
- TS7 재생 멱등: 같은 패킷열을 두 번 넣으면 alias 가 같고 큐 항목 1개.
- TS8 Feeder 메타: `signal='eeg'`, `segment_id`·`stream_id` UUID, alias 서버 패턴, sequence 단조.
- TS9 Uploader: presign 422 응답 `detail` 문자열이 `lastReason` 에 남음(DEAD_LETTER 유지, 사유 보존).
- TS10 큐 복구: meta.signal null 인 DEAD_LETTER feature → 보정 후 PENDING, 다른 항목 불변.
- TS11 (서버) 네이티브 fixture raw presign 200 → 가짜 PUT → ack uploaded + `verified_at_us`; feature presign 200; 구 null 메타는 422(회귀 보호).
- TS12 (iOS) 원시 청크·feature 메타 서버 필수 필드 포함, alias 패턴, 크기 ≤ 1MiB.
- TS13 (웹) PPG tick 불규칙 정상 패킷열 → segment 1개; 실제 큰 간극(>임계) → 분할 + gap 기록.
- TS14 (웹) pause/close 후 미봉인 journal 0건.

## Edge Cases
- [ ] 한 패킷이 청크 경계를 넘을 때 패킷은 쪼개지 않음(경계는 패킷 단위).
- [ ] 청크 크기 900KB 초과 직전 봉인.
- [ ] 프로세스 재생성 후 첫 패킷은 새 segment.
- [ ] 큐 디스크 가득/쓰기 실패는 수집을 멈추지 않음(원문은 raw.journal 에 있음).
- [ ] 동의 철회/권한 403 은 HALT(기존 동작) 유지.

## Security Review
- [ ] 토큰·서명 URL 로그 출력 없음. 진단에는 서버 `detail` 문자열(고정 문구)만.
- [ ] 개인정보를 alias·메타에 넣지 않음(결정적 UUID 해시만).
- [ ] 서버 인가 변경 없음(가산·완화 없음).
