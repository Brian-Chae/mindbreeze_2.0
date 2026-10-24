# EEG raw ACK 유실 수정 결과

- 기준: `aa3505b5952ff09c8529c9d4b3c86959d7be5280` (develop).
- 브랜치: `fix/eeg-raw-ack-loss`.
- 구현 전 verify 커밋: `2a3adbfe`. 사용자 요청의 [Fix] 승인 범위로 연속 진행했다.
- 구현자와 검증자를 분리했다. 감독이 diff·관련 테스트·실제 Chromium IndexedDB를 재검증했다.

## 원인 (기준 커밋의 파일:행)

| 위치 | 원인 |
|---|---|
| `frontend/src/hooks/useEegRawUpload.ts:181-184` | ACK 응답 본문 무시, HTTP 성공이면 청크 삭제 |
| 같은 파일 `:189-195`, `:225-239` | 특정 API 4xx·8회 초과를 로그만 남기고 실제 삭제 |
| `frontend/src/hooks/useBand.ts:455-472` | enqueue 완료 전 버퍼 해제, IndexedDB 장애 시 사본 유실 |
| `useBand.ts:452,1163`, `raw-chunk-queue.ts:124-134` | 재마운트 index=0과 재사용 feature stream 조합으로 청크 키 충돌 |
| `backend/app/services/eeg_raw_service.py:221-248` | HEAD 실패도 HTTP 200 + failed, 이미 저장된 청크 재ACK는 acked=0. 집계만으로 대상 청크 저장 여부 판정 불가 |

## 수정 및 결정

- 기존 ACK 집계 필드를 유지하고 `chunks[{chunk_id, upload_status, checksum, size_bytes}]`를 추가했다. DB commit 후 응답하며 재ACK도 uploaded 결과를 돌려준다. BE 마이그레이션은 없다.
- FE는 presign의 stream/index 매핑과 ACK의 session/단일 chunk ID/uploaded/checksum/size를 검증한 뒤 삭제한다. 구 서버 응답처럼 chunks가 없거나 부분 실패·중복 결과·메타 불일치면 보관한다. 서버 먼저 반영하면 기존 클라이언트도 호환되며, 새 클라이언트가 먼저 반영되면 보관 후 재시도한다.
- 특정 API 4xx 또는 8회 실패 이후 `quarantine`과 60초 cooldown을 영속 보관한다. 횟수 초과로 payload를 삭제하지 않는다. PUT 403은 서명 만료 복구 경로를 유지한다.
- ownerId가 기록된 청크는 동일 로그인 계정의 다음 세션에서도 재시도한다. 게스트·입장 자격·owner 없는 기존 큐는 원래 session/participant 범위로 제한한다. 자격 증명은 큐에 저장하지 않으며 네트워크 각 단계에서 소유 변경을 확인한다.
- API 영구 거부 누적 3회에 `upload_unavailable` 이벤트를 로컬 로그와 콘솔에 남긴다. 이는 업로드 불가 진단이며 payload는 계속 보관한다. 전용 서버 손실 이벤트 API를 추가하지 않았다.
- 큐는 64 MiB 상한이다. 초과 시 createdAt 기준 가장 오래된 청크부터 `capacity_eviction` 이벤트를 먼저 localStorage에 기록한 뒤 단일 IDB 트랜잭션으로 제거한다. 로그 저장이 실패하면 삭제도 실행하지 않는다. 진단은 최근 1,000건, raw/자격 증명 제외. 로그 선기록 뒤 IDB 트랜잭션이 실패하면 보수적인 손실 이벤트가 남을 수 있지만 payload 삭제는 롤백된다.
- enqueue 실패 시 고정 payload를 프로세스 메모리 큐에 보관하고 재시도한다. useBand는 commit 성공 후 캡처한 샘플만 제거한다. 종료·소유 세션 변경 시 미확정 청크와 후속 tail 모두 기존 소유자의 메모리 큐로 인계한다. 늦은 Promise 완료가 새 버퍼를 수정하지 않도록 세대를 검사한다.
- raw 전용 128-bit 난수 stream을 mount마다 생성한다. feature cursor를 변경하지 않으며, 같은 키에 다른 payload를 넣으면 보존 후 오류를 반환한다.
- 웹/Capacitor 공통 코드에 적용된다. 앱 배포 반영에는 다음 바이너리 빌드가 필요하다.

## TDD 및 독립 검증

| 검증 | 결과 |
|---|---|
| ACK/삭제 정책 RED | 20 실패, 8 통과 |
| IndexedDB 큐 RED | 4 실패 |
| BE 청크별 ACK RED | 1 실패 |
| useBand enqueue·재마운트 RED | 2 실패, 23 통과 |
| 실패 staged 뒤 종료 tail RED | 1 실패, 25 통과 |
| presign 매핑·중복 ACK RED | 2 실패, 30 통과 |
| 관련 FE 4파일, 감독 재실행 | **72 통과** |
| 관련 BE 3파일, 감독 재실행 | **53 통과** (mixed uploaded/failed 포함) |
| `tsc -b` + `npm run build -- --emptyOutDir false` | **통과**. 기존 dynamic import 경고 존재 |
| 실제 Chromium 프로세스 종료→재실행 | **통과**. IndexedDB payload `[1,2,3,4]`, quarantine, 같은 owner의 다른 session 복구, 타 계정·guest 격리, 키 충돌 거부, 로컬 이벤트 유지 |

실제 브라우저 독립 검증은 `node fix-notes/eeg-raw-ack-loss/verify-indexeddb.cjs`로 재현한다. 설치된 Chrome, frontend dependencies가 필요하며 임시 전용 브라우저 프로필을 사용한다. 모든 페이지 요청을 가로채 실제 서버에 접속하지 않는다. 실제 S3가 아닌 로컬 브라우저 영속성 증거다.

## 전체 회귀

- FE 기준 aa3505b5: 254파일 중 246 통과/8 실패, 테스트 **2,803 통과/17 실패**.
- FE 수정본: 255파일 중 247 통과/8 실패, 테스트 **2,827 통과/17 실패**. 실패 이름 집합 17개가 기준선과 정확히 같아 신규 회귀 0개. 신규 테스트 24개 통과.
- BE 기준 aa3505b5: **3,991 통과/468 건너뜀/실패 0**, 605.61초.
- BE 수정본 전체 실행: **3,991 통과/468 건너뜀/실패 0**, 530.54초. 실행 시작 후 추가한 mixed ACK 회귀 1건은 별도 관련 53건 실행에 포함해 통과했다. 전체와 추가 회귀를 합친 고유 테스트 기준 **3,992 통과/468 건너뜀**이다. 제품 코드 변경 후 전체를 실행했으며 이후 BE 변경은 이 추가 테스트뿐이다.
- 수정 소스 ESLint 및 `git diff --check` 통과.
- 전체 FE 테스트가 덮어쓴 기존 SDD-234 스크린샷·측정 파일 19개는 시작 시 깨끗했던 HEAD 내용으로 복원했다. 테스트 산출물 변경은 PR에 포함하지 않는다.

기존 FE 실패 17건(범위 밖 수정 없음):

| 파일 | 실패 시나리오 | 수 |
|---|---|---:|
| `agent-counselor-page.test.tsx` | CTA 진입, 메시지 전송 뒤 입력 처리 | 2 |
| `chat-message-deeplink.test.ts` | missing/failure 시 최근 대화 복귀 | 2 |
| `org-counselor-management-browser.test.cjs` | 상담사 보호·역할·소속 해제 | 1 |
| `org-management-browser.test.cjs` | 기관 모달 변경, 목록 상태 필터·포커스 복귀 | 2 |
| `report-modal-pdf.test.cjs` | 수신 주소 존재/없음 PDF | 2 |
| `report-server-pdf.test.cjs` | detail/email PDF | 2 |
| `sdd220-native-release.test.ts` | TS1 iOS 버전, TS29 Android 버전 | 2 |
| `sdd234-a-mobile-home.test.tsx` | member/host의 768px·1440px 측정값 | 4 |

브라우저/PDF 7건은 기존 로컬 dev 서버(5175) 의존 timeout/연결 실패, 나머지는 기존 UI 기대·native 버전·측정 스냅샷 불일치다. 전체 실행 결과를 green으로 표시하지 않는다.

## 검증 한계와 범위

- 전체 pytest는 SQLite 인메모리 fixture와 빈 AWS 자격 증명으로 실행한다. 실제 PostgreSQL·S3·서버·.env·메일·실기기·앱 바이너리는 검증하지 않았다.
- 기존 서버 HEAD는 객체 존재·크기만 확인한다. SHA-256 서버 재검증과 설정 없는 storage stub 허용은 기존 동작이며 이번 수정의 보장에 포함되지 않는다.
- IndexedDB 사용 불가 상태에서 앱/탭 프로세스를 강제 종료하면 메모리 사본은 유지할 수 없다. 정상 enqueue 성공분은 브라우저 프로세스 재시작 후 복구를 확인했다.
- SDD-244 spec/research는 읽기만 했다. 새로운 신호 파이프라인·다운로드·manifest·DB 마이그레이션은 추가하지 않았다.
- merge, develop push, 배포, 메일 발송, 파일/브랜치 삭제를 수행하지 않는다.
