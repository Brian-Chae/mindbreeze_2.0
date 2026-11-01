# SDD-260 API (P0-4 계약 고정)

정본: [`specs/sdd-260-live-ingest-bottleneck/contract.md`](../specs/sdd-260-live-ingest-bottleneck/contract.md) (요청·응답·에러코드·예시 JSON).
변경은 TASK BOX 승인 후 contract.md 와 이 문서를 같이 고친다.

| 메서드·경로 | 용도 | 권한 |
|---|---|---|
| `POST /api/v1/sessions/{id}/features/batch` | feature 정본 저장(≤300창, 멱등) | 참가자 본인(JWT·입장 자격) |
| `GET /api/v1/sessions/{id}/features/summary?participant_id=` | 저장 현황·결측 구간(종료 대조) | 본인·호스트 |
| `GET /api/v1/sessions/{id}/biosignal-raw/summary?participant_id=` | 원시 업로드 현황·영수증 해시 | 본인·호스트 |
| `GET /api/v1/admin/ingest-metrics` | 저장 계측 | platform_admin |
| ~~`POST /api/v1/sessions/{id}/features`~~ | 삭제(404) | — |

소켓 `live:metric` 은 방송 전용: ACK `status = projected | ignored`, `durable` 없음, 앱은 ACK 로 outbox 를 acked 처리하지 않는다.
