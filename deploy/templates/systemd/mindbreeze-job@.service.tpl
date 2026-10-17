# MIND BREEZE 2.0 — 주기 작업 공통 서비스. 인스턴스명 %i = jobs.tsv 의 name, 스크립트 = backend/%i_cron.py
# flock -n -E 0: 이전 실행이 끝나지 않았으면 조용히 건너뛴다(중복 실행 방지). 로그는 journald.
[Unit]
Description=MIND BREEZE job %i
After=network.target redis-server.service
OnFailure=mindbreeze-job-failed@%i.service

[Service]
Type=oneshot
User=@@SERVICE_USER@@
Group=@@SERVICE_USER@@
WorkingDirectory=@@PREFIX@@/current/backend
EnvironmentFile=@@ENV_FILE@@
ExecStart=/usr/bin/flock -n -E 0 /run/lock/mindbreeze-job-%i.lock @@PREFIX@@/venv/bin/python @@PREFIX@@/current/backend/%i_cron.py
UMask=0077
NoNewPrivileges=true
SyslogIdentifier=mindbreeze-job-%i
