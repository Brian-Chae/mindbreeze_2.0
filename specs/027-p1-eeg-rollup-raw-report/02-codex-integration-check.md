## P1 충족 판정

**판정: 미충족 — SDD-027 구현 완료 및 통합 승인 불가.** 현재 작업 트리에는 spec/plan/verify가 있지만, 핵심인 60초 조회·raw 업로드·Report 상태머신 구현이 확인되지 않는다. 기존 기능의 회귀 통과를 P1 수락 기준 통과로 해석해서는 안 된다.

검토일: 2026-09-08. 기준 HEAD: `3568dadd71c5cd8041db1959886890728e02fc6f`. 커밋만이 아니라 당시 로컬 작업 트리를 읽었다. 시작 시 기존 변경은 `specs/.sdd-counter` 수정과 SDD-027 디렉터리 미추적 상태였다. 아래 경로와 행 번호는 저장소 루트 기준이다. 코드·테스트·마이그레이션과 기존 spec/plan/verify는 수정하지 않았다.

**동시 변경 및 판정 시점:** 회귀 실행·본문 작성 후 마지막 확인에서 외부 작업의 `backend/app/models/record.py` 수정(docstring/import에 EEGRawChunk 관련 준비)과 `frontend/src/lib/api/report-status.ts` 신규 파일을 감지했다. 확인한 diff에서는 모델 필드·raw API·서버 상태 전이 추가는 없었다. FE에는 4상태 타입·한글 라벨·quality 기반 신뢰도 매핑·승인 버튼 판정 헬퍼가 생겼으므로 “프런트 상태 관련 코드가 전혀 없다”는 판정은 하지 않는다. 다만 서버 계약과 화면 연동 완료 증거는 아니며, 아래 회귀 수치는 이 동시 변경 이전 실행 결과다. 이후 계속 변경되는 작업 트리 전체를 통과 판정한 문서가 아니다.

`verify.md`의 11개 항목별 판정:

1. **60초 버킷·valid_count·coverage·시간 범위: 미충족.** `EEGFeatureWindow`는 1초 원천이다(`backend/app/models/eeg_feature.py:45-78`). 현행 live 집계는 참여자별 전체 평균과 최신값만 반환한다(`backend/app/services/session_service.py:1046-1087`). features POST와 live-metrics GET은 있지만 1초/60초 해상도 조회 계약은 확인되지 않는다(`backend/app/api/v1/session.py:162-190`). 알고리즘 버전별 롤업 계약도 없다.
2. **null/불량 0 치환 없음: 부분 충족.** 모델의 지표 nullable, FE의 SQI·밴드파워 null 전달, 리포트 정규화의 null 보존은 확인했다(`backend/app/models/eeg_feature.py:56-76`, `frontend/src/hooks/useBand.ts:123-141`, `backend/app/services/report_service.py:57-71`). 그러나 불량값의 집계 제외는 미충족이며, 아직 없는 60초 경로에 대한 통과 판정은 불가능하다.
3. **전체 평균의 유효 샘플 가중: 미충족.** 현재 전체 평균은 non-null 원천 수로 나누지만 quality를 거르지 않는다(`backend/app/services/session_service.py:1075-1077`). 버킷 평균을 잘못 단순 평균하는 구현이 발견된 것은 아니다. 롤업 자체가 없고, 유효 수를 이용한 결합 계약도 없다.
4. **EEGRawChunk + presigned PUT/ack: 미충족.** `backend/app`, `backend/alembic`, `backend/tests`, `frontend/src`에서 관련 모델·계약·경로를 검색했으나 찾지 못했다. `EEGRecord.s3_key` 정의만으로 업로드 동작을 인정할 수 없다(`backend/app/models/record.py:44-56`).
5. **게스트 raw 저장: 미충족.** `EEGRecord.user_id`는 여전히 NOT NULL이며 participant_id/play_group_id/file_count가 없다(`backend/app/models/record.py:47-54`). feature의 게스트 지원과 raw의 게스트 지원은 별개다.
6. **raw participant 소유 검증: 미충족.** raw API가 없어 적용·거부 동작을 검증할 수 없다. 재사용 대상으로 지정된 feature 검증도 게스트 본인 증명을 하지 않는 한계가 있다(`backend/app/services/session_service.py:1136-1151`).
7. **Report 4단계: 미충족.** 모델·응답·FE DTO에 lifecycle status가 없다(`backend/app/models/record.py:59-70`, `backend/app/schemas/report.py:21-33`, `frontend/src/lib/api/reports.ts:26-39`). `content.eeg.status`는 품질 상태이며 Report 상태가 아니다.
8. **pending_review 승인 게이트: 미충족.** 호스트 승인 API는 있지만 현재 상태 검증 없이 approved와 sent_at을 설정한다. 수신자 조회도 승인 여부를 확인하지 않는다(`backend/app/services/report_service.py:177-203,222-253`).
9. **data_credibility의 quality 파생: 부분 기반만 존재, 수락 기준 미충족.** quality로 reliability와 EEG status를 산출하는 기존 엔진은 있다(`backend/app/services/eeg_metrics.py:267-284`). 그러나 요구한 data_credibility 필드·매핑은 없고, 참여자 및 불량 구간 처리에도 아래 결함이 있다.
10. **백엔드 회귀: 실행된 테스트 통과, 1건 미실행.** `cd backend && ./venv/bin/python -m pytest -q` → **276 passed, 1 skipped, 11 warnings, 28.99s, exit 0**. skip은 `backend/tests/test_sdd_c01.py:109`의 JWT fixture 미비 내담자 포털 통합 테스트다. P1 신규 시나리오의 구현·통과 증거는 아니다.
11. **프런트 타입·빌드: 통과.** `cd frontend && npm run build` → `tsc -b && vite build`, 타입 오류 없이 **exit 0**, 773 modules. tokens.css import 해석 경고와 500 kB 초과 청크 경고가 남았다. 브라우저 표시 품질까지 검증한 결과는 아니다.

검증 한계: 정적 경로 추적과 기존 회귀 실행이다. PostgreSQL 마이그레이션, 실기기 BLE, 실제 S3 PUT/HEAD/checksum, 브라우저 재시작·종료 drain은 실행하지 않았다. pytest는 SQLite 인메모리/fakeredis 기반이다(`backend/tests/conftest.py`). 경고에는 승인 테스트의 `broadcast_notification was never awaited`도 있어 알림 전달 완료를 입증하지 못한다.

## 잔여 결함

**1. [높음] 품질 불량 수치가 라이브 평균과 리포트 산식에 포함된다.**

`_aggregate_window_stats`는 relaxation_index가 null인지 여부만 본다(`backend/app/services/session_service.py:1075-1077`). 예를 들어 valid 20과 invalid 100이 있으면 현재 산식은 60이며, 불량 제외 기대값은 20이다. 이는 코드 산식에 따른 정적 반례이며 별도 신규 테스트 실행 결과는 아니다. `_build_eeg_content.series()`도 quality와 무관하게 모든 값을 전달하고, 계산 엔진의 mean은 유한값만 거른다(`backend/app/tasks/report_task.py:85-107`, `backend/app/services/eeg_metrics.py:119-121,321-338`). 세션 전체 품질 게이트를 통과하는 혼합 데이터에서는 invalid 수치가 최종 점수에도 영향을 준다.

필요 조치: 지표별 null과 invalid/unknown을 제외하는 공통 정책, 지표별 valid_count, 합계/유효 수 기반 가중 결합을 정의한다. degraded 포함 여부도 명시해야 한다. 현재 엔진은 degraded를 usable로 인정한다. 서로 다른 유효 수의 버킷을 검증할 때 평균 20·유효 수 60과 평균 80·유효 수 1의 전체 평균은 `1280/61 ≈ 20.9836`이며 50이 아니다. 전부 null/불량인 경우 평균은 null이어야 한다.

**2. [높음] 리포트가 여러 참여자의 EEG를 혼합하고 시간 공백을 연속 구간으로 센다.**

리포트 입력 조회는 session_id만 필터링하고 window_index만 정렬한다(`backend/app/tasks/report_task.py:71-86`). 사용자·participant·play_group 구분이 없어 개인 리포트에 다른 참여자 지표가 들어간다. `_longest_usable_run`은 인접 초인지 확인하지 않고 행 수를 증가시킨다(`backend/app/tasks/report_task.py:59-68`). 따라서 중간 미수신이나 다른 참여자의 동일 초 행도 연속 길이를 부풀린다. timeline도 참여자·세그먼트 없이 t만 출력한다(`backend/app/tasks/report_task.py:114-123`).

필요 조치: 개인 리포트는 participant 기준으로 분리하고, 세그먼트·실제 시간 경계에서 연속 구간을 끊는다. 모델은 play_group별 window_index 재시작을 허용한다(`backend/app/models/eeg_feature.py:25-29,45-49`). 향후 `window_index // 60`만으로 세션 전체를 묶으면 다른 세그먼트의 0번 버킷이 합쳐질 수 있으므로 시간축 계약을 먼저 확정해야 한다. coverage의 분모도 수신 행 수가 아니라 해당 시간 범위의 기대 샘플 수인지 명시한다.

**3. [높음] 게스트 raw·개인 리포트의 소유 모델이 미완성이다.**

EEGRecord와 Report 모두 user_id 필수다(`backend/app/models/record.py:49,64`). 내담자 리포트 생성은 첫 참여자의 user_id를 사용하므로 첫 참여자가 게스트면 새 Report flush 시 NOT NULL 제약과 충돌한다. 기존 조회 키도 session_id/type뿐이라 그룹의 참여자별 리포트 생성 계약이 없다(`backend/app/services/report_service.py:133-155`). nullable 변경만으로는 충분하지 않으며 participant 소유 키, 생성 대상 선택, 직렬화·응답 nullable 계약까지 함께 바뀌어야 한다.

**4. [높음] 기존 소유 검증을 그대로 재사용해도 게스트 본인 확인은 충족되지 않는다.**

미인증 업로드 분기는 session_id·participant_id·user_id IS NULL만 확인한다. 현재 함수 인자에도 게스트 credential이 없다(`backend/app/services/session_service.py:1103-1107,1136-1151`). 동의한 게스트의 두 ID를 아는 요청자를 본인과 구별하지 못한다. 동의/대기열 검사는 존재하지만 본인 증명을 대체하지 못한다. 이는 현행 feature 검증의 잔여 결함이자 raw 구현 시 재사용 위험이며, 아직 없는 raw API의 실제 공격 성공을 주장하는 것은 아니다.

필요 조치: 서버 발급 게스트 참여 credential을 session/participant에 바인딩하고 presign·ack 모두 검증한다. 타 세션·타 참여자 object_key와 위조 checksum/완료 ack도 거부해야 한다.

**5. [높음] 리포트 승인·오류·재생성 상태 전이가 보장되지 않는다.**

생성 중 표시로 `content.status=generating`을 넣지만 생성기가 content를 통째로 교체한다. 실패도 error 상태 전이가 아니라 fallback content 저장이다(`backend/app/services/report_service.py:148-158`, `backend/app/tasks/report_task.py:189-201`). EEG 계산 예외는 not_measured로 바뀌어 측정 실패와 미착용을 혼동한다(`backend/app/tasks/report_task.py:108-110`). 승인 함수에는 pending_review 전제, 실패 리포트 승인 금지, 중복 승인 멱등 처리가 없다(`backend/app/services/report_service.py:222-253`).

또한 내담자 목록·상세 조회는 소유자 조건만으로 승인 전 content를 반환한다(`backend/app/services/report_service.py:177-203`). 승인된 기존 Report 재생성 시 approved=False로 내용은 바뀌지만 sent_at은 유지된다(`backend/app/tasks/report_task.py:163-174,199-201`). 필요 조치: 상태 전이를 서비스에서 강제하고, 완료된 승인본만 내담자에게 공개하며 재생성·재시도·중복 승인 규칙을 명시한다. 상담 기록 상태, raw 업로드 상태, Report lifecycle, EEG quality를 별도 계약으로 유지한다.

**6. [높음] raw 영속 경로가 없으므로 feature 큐의 복구를 raw 보존으로 인정할 수 없다.**

useBand는 계산된 metrics를 feature로 바꿔 enqueueFeature에 저장한다(`frontend/src/hooks/useBand.ts:367-395`). 연결 시 metrics 콜백을 연결하지만 raw chunk 적재·PUT·ack는 없다(`frontend/src/hooks/useBand.ts:533-560`). 종료 drain도 이 feature 큐 대상이다(`frontend/src/hooks/useBand.ts:293-335,460-481`). EEGRawChunk, 업로드 상태, checksum 확인, 마지막 불완전 chunk 확정까지 모두 미구현 판정이다.

**7. [중간] null이 0으로 바뀌지 않아도 과거 정상값으로 대체되는 표시가 남는다.**

metrics 콜백은 최신 SQI가 null이면 이전 signalQualityRef 값을 사용한다(`frontend/src/hooks/useBand.ts:538-541`). 서버 이벤트에서도 efficiency/focus/stress/SQI가 null이면 현재 상태를 지우지 않는다(`frontend/src/hooks/useBand.ts:673-687`). 따라서 정상값 다음에 측정 불가가 오면 과거 수치가 남을 수 있다. null 보존 검증은 DB뿐 아니라 UI 갱신까지 포함해야 한다. 이전 값을 보관하려면 현재값과 분리하고 마지막 측정 시각을 함께 표시해야 한다.

**8. [중간·동시 변경분] 새 FE 상태 폴백은 기존 오류·재생성 모순을 가릴 수 있다.**

최종 확인에 추가된 `frontend/src/lib/api/report-status.ts:44-55`는 서버 status가 없으면 sent_at만으로 completed/pending_review를 결정한다. 기존 생성 실패 content.error는 입력에 없으므로 오류도 검수 대기로 해석하고, 재생성 후 남은 sent_at은 완료로 해석한다. `canApproveReport`도 이 결과를 사용한다(`frontend/src/lib/api/report-status.ts:102-110`). 실제 화면 연결 여부는 별도 검증 대상이며, 이 헬퍼만으로 서버 승인 게이트 충족을 인정할 수 없다.

## raw S3 출시 게이트 판정

**raw 보존·향후 재분석을 약속하는 EEG 수집 배포에는 출시 전 필수 게이트이며, 현재는 통과하지 못했다.** 근거 로드맵도 이를 명시한다(`specs/025-live-session-parity-analysis/02-codex-integration-review.md:38,93-99`). SDD-027은 raw를 명시적으로 수락 기준에 포함했으므로 raw 없이 이 SDD를 완료 처리할 수 없다.

반면 무밴드 상담·명상 또는 raw 보존을 약속하지 않는 feature 기반 라이브 확인만의 제한 배포에는 raw를 일률적인 출시 차단 조건으로 적용하지 않는다. 이는 해당 제한 배포의 다른 안전성·승인 게이트까지 통과했다는 뜻이 아니다. 특히 위 소유 검증·승인 전 노출 문제는 독립적으로 해결해야 한다. 실제 배포가 raw 보존을 약속하는지에 관한 제품 결정은 이번 입력만으로 확정할 수 없으므로 조건부로 판정한다.

raw 게이트의 최소 통과 증거는 다음과 같다.

- 동의한 회원·게스트 각각의 SDK raw → 로컬 영속 chunk → presigned PUT → 서버 객체 존재·checksum 확인 → manifest 확정 전 경로 성공. object_key만 저장하거나 클라이언트 ack만 신뢰하는 것으로 대체하지 않는다.
- 네트워크 단절, presign 만료, PUT 후 ack 유실, 중복 PUT/ack, 브라우저 재시작, 종료 직전 마지막 chunk에서 유실·중복 확정이 없음을 검증한다. 확인 완료 전 로컬 chunk를 삭제하지 않는다.
- participant 소유권, 세션·stream·chunk 식별, 시간 범위, sample_rate·채널·단위·schema_version·checksum 계약과 게스트 마이그레이션을 검증한다.
- 보관 기간 만료·동의 철회/삭제 시 객체와 manifest의 처리 정책 및 실제 동작을 검증한다. 외부 S3 설정과 운영 삭제 동작은 이번 회귀 테스트로 확인되지 않았다.

## 최종 권고안

1. **SDD-027은 미충족으로 유지한다.** 기존 pytest·빌드는 통과했지만 핵심 기능을 구현했다는 증거가 없다. 다른 작업 트리에서 구현 중인 코드가 있다면 통합된 시점의 코드를 다시 검증해야 한다.
2. 구현 전에 기존 verify에 참여자/세그먼트별 버킷, 지표별 유효 수와 coverage 분모, 게스트 credential, 승인 전 조회 차단, 실패/재생성 전이를 구체화한다. 이 검증 문서로 기존 사전 verify를 사후 대체하거나 체크 완료 처리하지 않는다.
3. 롤업은 `0/59/60/119` 경계, 부분 마지막 버킷, 미수신 초, null·invalid 혼합, 불균등 유효 수, pause/resume, 다중 참여자를 검증한다. raw는 위 출시 게이트, Report는 정상 전이·금지 전이·실패·재시도·중복 승인·게스트 생성을 확인한다.
4. 실제 구현 후 PostgreSQL 마이그레이션과 브라우저–S3 통합 증거를 추가하고 전체 회귀를 다시 수행한다. 이번 작업의 산출물은 본 문서 하나이며, 출시·구현 승인이나 코드 수정은 수행하지 않았다.
