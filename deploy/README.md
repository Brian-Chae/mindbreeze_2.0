# deploy/ — 운영(prod) 서버 구성·릴리스 (SDD-210)

저장소에는 **템플릿과 키 이름만** 둔다. prod 값은 SSM Parameter Store(`/mindbreeze/prod/*`)에만 있다(공개 저장소, R15).

| 경로 | 용도 |
|---|---|
| `templates/` | nginx · livekit · coturn · systemd 유닛 템플릿(`@@VAR@@` 토큰) |
| `render.py` | 템플릿 → 서버 루트 구조 출력(+ `jobs.tsv` 기반 timer·타임아웃 드롭인 생성). 시크릿은 환경변수 `MB_RENDER_*` 로만 전달 |
| `render_env.py` | SSM → `/etc/mindbreeze/prod.env`(0600) 렌더. 매니페스트 검증·dev 흔적 검사·값 미출력 |
| `env-manifest.tsv` | 운영 환경 변수 키 목록(필수/선택/static) |
| `jobs.tsv` | 주기 작업 단일 목록(14개 활성 + SDD-209 2종 비활성) |
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
