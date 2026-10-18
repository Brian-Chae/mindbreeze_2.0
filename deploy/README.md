# deploy/ — 운영(prod) 서버 구성·릴리스 (SDD-210)

저장소에는 **템플릿과 키 이름만** 둔다. prod 값은 SSM Parameter Store(`/mindbreeze/prod/*`)에만 있다(공개 저장소, R15).

| 경로 | 용도 |
|---|---|
| `templates/` | nginx · livekit · coturn · systemd 유닛 템플릿(`@@VAR@@` 토큰) |
| `render.py` | 템플릿 → 서버 루트 구조 출력(+ `jobs.tsv` 기반 timer·타임아웃 드롭인 생성). 시크릿은 환경변수 `MB_RENDER_*` 로만 전달 |
| `render_env.py` | SSM → `/etc/mindbreeze/prod.env`(0600) 렌더. 매니페스트 검증·dev 흔적 검사·값 미출력 |
| `env-manifest.tsv` | 운영 환경 변수 키 목록(필수/선택/static) |
| `jobs.tsv` | 주기 작업 단일 목록(dev cron 14개 + SDD-212 적체 감시 1개 = 15개 활성, SDD-209 2종 비활성) |
| `apply-config.sh` | 렌더 결과를 서버에 설치(서버 root, T-14) |
| `jobs-ctl.sh` | timer 일괄 enable/disable(컷오버 실행 주체 전환) |
| `notify-job-failure.sh` | 작업 실패 알림(journald + 선택 SNS) |
| `install-release.sh` | 릴리스 설치·링크 전환·롤백(T-5) |
| `precheck/` | 컷오버 사전 집계 SQL(읽기 전용, T-1) |
| `cutover/` | 컷오버 실행 세트(C-0~C-10 스크립트·점검 페이지·롤백, 운영자 로컬 실행 — 릴리스에는 싣지 않음) → `cutover/README.md` |

## 렌더 (서버에서, T-14)
```bash
sudo -E env MB_RENDER_LIVEKIT_API_KEY=… MB_RENDER_LIVEKIT_API_SECRET=… MB_RENDER_TURN_STATIC_AUTH_SECRET=… \
  python3 deploy/render.py --out /tmp/mb-render \
  --set WEB_HOST=mindbreeze.looxidlabs.com --set API_HOST=api.mindbreeze.looxidlabs.com \
  --set PUBLIC_IP=<EIP> --set PRIVATE_IP=<사설 IP>
sudo bash deploy/apply-config.sh /tmp/mb-render
sudo python3 deploy/render_env.py --out /etc/mindbreeze/prod.env      # 인스턴스 역할로 SSM 읽기
```

## 서버 레이아웃 (T-D8)
`/opt/mindbreeze/releases/<릴리스ID>/{dist,backend,deploy}` · `current`→릴리스 · `venvs/<requirements 해시>` · `venv`→venvs/<해시> · 환경 `/etc/mindbreeze/prod.env`.

## dev 서버에서 확인한 사실(2026-10-17, 읽기 전용) — 템플릿에 반영
- LiveKit: 7880(시그널링)·`rtc.tcp_port 7881`·`use_external_ip:false`·`node_ip`=공인 IP. UDP 범위 미지정(dev SG 전체 개방) → prod 는 **50000–50200/UDP 고정**(SG 에도 필요).
- coturn: 3478(UDP/TCP)·릴레이 49152–49200. 5349/TLS 는 인증서 미설정으로 dev 에서도 비활성. `relay-ip` 가 공인 IP(바인드 불가) → prod 는 `external-ip=공인/사설` 표준 형식(T-15 TURN 경유 시험 필수).
- 서버 시간대 UTC → jobs.tsv 는 UTC 기준(dev cron 과 동일 시각).
- 오디오·영상 청크는 호스트 `/tmp`(`/tmp/mindbreeze_audio` 등)를 백엔드·워커가 공유 → 해당 유닛은 `PrivateTmp` 미사용.

## 리포트 생성 줄(큐) 분리·적체 모니터링 (SDD-212)

### 구성
| 일꾼 유닛 | 줄 | 동시 처리 | 처리 태스크 |
|---|---|---|---|
| `mindbreeze-stt-worker` | `stt` | 2 | 음성 변환(`tasks.stt`), 영상 병합 |
| `mindbreeze-report-worker` | `report` | 2 | 요약, 리포트 생성(`tasks.summary`/`generate_reports_for_session`/`report`) |
| `mindbreeze-worker` | `celery`(기본) | 1 | 아웃박스·알림·예약 등 나머지 |
- 동시 처리 수는 유닛 인자(`--concurrency`)다. **초기값은 가정(서버 2 vCPU·4GB, 일꾼 5프로세스)** — 실측(T0) 후 조정한다.
- **dev**: `deploy-dev.yml` 이 `mindbreeze-stt-worker`·`mindbreeze-report-worker` 를 설치·기동한다(`backend/deploy/*.service`, 멱등). 기존 `mindbreeze-worker` 는 인자 변경 없이(기본 줄만 소비) 둔다 — 플래그를 끄면 단일 줄 구성으로 즉시 복귀하도록. 라우팅 플래그는 서버 `.env.dev` 에서 수동 관리(워크플로 불간섭). dev 실측·재현 결과: `specs/sdd-212-report-queue/t0-measurement.md`.
- 줄 분리는 환경 변수 `PIPELINE_QUEUE_SPLIT_ENABLED` 로 켠다(운영 매니페스트 기본 `true`, 코드 기본 `false`). 꺼져 있으면 기존 단일 줄 구성이다.

### 배포 순서 (순서를 어기면 유실이 아니라 **지연**만 생긴다 — 메시지는 Redis 에 보존)
1. 신규 일꾼 유닛 설치·기동(`install-release.sh`가 `mindbreeze-stt-worker`·`mindbreeze-report-worker`를 기존 일꾼보다 먼저 재시작). 이 시점 두 줄은 비어 있다.
2. 라우팅 설정 적용(`PIPELINE_QUEUE_SPLIT_ENABLED=true`) → 이후 적재분부터 `stt`/`report` 줄로 들어간다.
3. 기존 일꾼은 `-Q celery --concurrency=1`. **변경 직전 기본 큐(`celery`) 잔량을 확인**한다: `redis-cli llen celery`. 잔량이 있으면 비워진 뒤(또는 임시로 `-Q celery,stt,report`) 적용.
4. 확인: `GET /api/v1/admin/pipeline/backlog`(platform_admin 토큰)으로 줄별 대기 건수·최장 대기 시간을 보고, 일꾼 생존(줄별 소비자 수)은 `report_backlog_probe` 로그의 `consumers` 로 본다.

### 롤백 (설정 한 곳)
1. `PIPELINE_QUEUE_SPLIT_ENABLED=false` 로 되돌리고 백엔드·일꾼 재시작 → 새 작업은 다시 `celery` 줄로 들어간다.
2. 신규 줄에 남은 잔량은 임시로 소비해 비운다: 기존 일꾼 인자를 `-Q celery,stt,report` 로 바꿔 재시작 → 잔량 0 확인(`llen stt`, `llen report`) → 인자 원복.
3. 신규 유닛 2종 중지(`systemctl stop mindbreeze-stt-worker mindbreeze-report-worker`).

### 대기 시간 보정 설정
| 변수 | 기본 | 의미 |
|---|---|---|
| `PIPELINE_QUEUE_GRACE_SECONDS` | 3600 | 정체 스윕이 녹음 종료 후 30분에 **더하는 대기 유예**. 진짜 정체는 90분 뒤 `failed` 로 마감 |
| `PIPELINE_REDRIVE_DELAY_SECONDS` | 5400 | 발행 후 체인 미완료로 보고 재발행하기까지의 지연. 줄이 밀려 있으면(대기 건 존재) 이번 회차 보류, 지연의 2배가 지나면 재발행 |
- 리포트 생성 태스크: soft 25분 / hard 28분(정체 스윕 30분 안쪽). 시간 초과 시 재시도는 이미 만든 회원 리포트를 건너뛰고 이어서 처리한다.

### 적체 지표·경보
- `report_backlog_probe`(1분 주기 timer)가 JSON 한 줄을 로그(journald)로 출력한다: `journalctl -u mindbreeze-job@report_backlog_probe`. `alerts` 배열에 `oldest_wait_exceeded`/`queue_length_exceeded:<줄>`/`no_consumer:<줄>` 가 담긴다.
- CloudWatch 사용자 지정 지표(`MindBreeze/Pipeline`) 게시는 `PIPELINE_METRICS_CLOUDWATCH_ENABLED`(운영 기본 `false`). **AWS 변경이라 별도 승인 후**에만 켠다. 준비물(미실행): `deploy/aws/pipeline-metrics-policy.json`(IAM 최소 정책), `deploy/aws/t14-pipeline-alarms.sh`(`MB_PIPELINE_ALARMS_APPROVED=yes` 없이는 실행 거부).
- 경보 임계 기본: 최장 대기 1800초(D-3 몰림 목표 45분의 2/3), 줄별 대기 20건. 설정: `PIPELINE_ALERT_MAX_WAIT_SECONDS`, `PIPELINE_ALERT_QUEUE_LEN`.
