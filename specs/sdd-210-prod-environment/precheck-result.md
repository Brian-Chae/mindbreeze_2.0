# [SDD-210] T-1 사전 집계 결과 (dev DB, 2026-10-17, 읽기 전용)

- 실행: `deploy/precheck/run-precheck.sh` (`cutover-precheck.sql`, `BEGIN READ ONLY` + `default_transaction_read_only=on`). 집계(건수·바이트)만 출력, 개인정보·토큰·코드 값 미출력.
- 재실행 가능: 컷오버 직전(C-0)에 같은 스크립트 결과를 파일로 보존해 전후 비교 기준으로 쓴다.

| # | 항목 | 결과 |
|---|---|---|
| Q1 | alembic head | `e036a0000051` |
| Q2 | 접속 코드 | 4자리: 31건(completed 14·scheduled 17) / 6자리: 79건(cancelled 6·completed 68·in_progress 1·ready 2·scheduled 2) / NULL 24. `legacy_access_code` 보유 0건 |
| Q3 | **6자리 코드 + 비종료 세션** | in_progress 1 · ready 2 · scheduled 2 → **5건** (컷오버 영향 대상. 완료·취소 74건은 무관) |
| Q4 | 진행·예정 | in_progress 1 · ready 3 · scheduled 19 (24시간 내 0건, 7일 내 scheduled 17건) |
| Q5 | notification_outbox | email sent 231 · push sent 63/skipped 43 · ws sent 731 → **pending/failed 0건** (미발송 없음) |
| Q6 | pipeline_outbox | published 52 (대기 0) |
| Q7 | device_tokens | android 2(활성 1) · ios 2(활성 2) · web 5(활성 1) — 활성 4건 컷오버 시 비움 |
| Q8 | refresh_tokens | 총 5,924 / 미폐기 1,592 |
| Q9 | auth_provider | dev 3(client·counselor·org_admin 각 1) · email 13(platform_admin 2 포함) · google 2 |
| Q10 | dev 계정 참조 FK | refresh_tokens 300, sessions.host_id 32, notifications 26, notification_outbox 22, reports 9, chat_rooms.host_id 8, chat_message_reads 5, client_counselor_links 6(counselor 4+client 2), chat_messages 3, onboarding_progress 3, client_invites 2, user_org_memberships 2, organizations.primary_admin_id 1, agent_counselor_settings 1, counselor_profiles 1, session_participants 1 → **삭제 대신 비활성화**가 안전(참조 행 다수) |
| Q11/12 | **S3 키 형식** | 절대 URL·dev 버킷명·dev 호스트 포함 **0건** (R7 해소: 버킷명 없는 키라 prod 버킷 복사만으로 해석됨). `eeg_raw_chunks` 1,550건 전부 `eeg-raw/` 접두사·uploaded·3,080,000바이트 |
| Q12b | **⚠ 로컬 경로 키** | `audio_chunks.file_path` 1,405건 중 1,405건이 `/`로 시작(`/tmp/mindbreeze_audio/…` 1,383, `/var/lib/…` 22), `video_chunks` 982건 `/tmp/mindbreeze_video/…`, `session_records.video_s3_key` 18건 `/var/lib/…`. 나머지 video_chunks 1,295건·session_records.video 20건은 `video/…` 상대 S3 키 |
| Q14 | 테이블 행 수 | 63개 테이블 전수 — 주요: users 18, sessions 134, session_records 74, reports 146, eeg_feature_windows 46,106, eeg_raw_chunks 1,550, video_chunks 2,277, audio_chunks 1,405, notification_outbox 1,068, refresh_tokens 5,924 (컷오버 전후 정합 기준은 C-0 재실행값 사용) |
| Q15 | DB 크기 | 54 MB |

## 발견 사항 (Brian 결정이 아닌 기술 처리 항목)
1. **로컬 디스크 경로를 가리키는 청크 행**(오디오 1,405·영상 982+18): 해당 파일은 S3 가 아니라 dev 서버 로컬(`/tmp`·`/var/lib`)에 있거나 이미 병합·삭제됨. S3 sync 만으로는 이관되지 않음 → T-17 리허설에서 (a) 해당 파일의 서버 존재 여부, (b) 병합 완료 후 정리되는 임시 청크인지(`session_records` 가 병합 결과 키를 가졌는지) 확인 필요. 청크가 임시 산출물이면 컷오버 대상 아님으로 문서화, 실데이터면 로컬 파일 이관 단계를 런북 C-4 에 추가.
2. 6자리 코드 비종료 세션 5건: 컷오버 전 종료/재발급 확인 대상(진행 중 1건은 점검 진입 전 0건이어야 함).
3. 알림 대기열이 비어 있어 이중 발송 위험은 현재 낮음(컷오버 시점 재확인 필수).
