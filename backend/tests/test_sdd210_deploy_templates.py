"""SDD-210 T-3: 서버 구성 템플릿 렌더·환경 매니페스트 검증 (deploy/ 디렉터리).

AWS·서버에 접속하지 않는다. 템플릿이 변수만으로 렌더되고, 운영 렌더 결과에 dev 흔적이 없으며,
jobs.tsv 가 dev 서버의 실제 cron 14개와 일치하는지, 환경 매니페스트가 fail-fast 와 정합한지 확인한다.
"""
import importlib.util
import re
import stat
import sys
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
BACKEND = Path(__file__).resolve().parents[1]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


render = _load("render")
render_env = _load("render_env")

PROD_VARS = {
    "WEB_HOST": "mindbreeze.looxidlabs.com",
    "API_HOST": "api.mindbreeze.looxidlabs.com",
    "PUBLIC_IP": "203.0.113.10",
    "PRIVATE_IP": "10.20.1.10",
}
PROD_SECRETS = {
    "MB_RENDER_LIVEKIT_API_KEY": "APIprodkey123",
    "MB_RENDER_LIVEKIT_API_SECRET": "prodsecretvalue456",
    "MB_RENDER_TURN_STATIC_AUTH_SECRET": "turnsecretvalue789",
}


def _vars(**over):
    sets = [f"{k}={v}" for k, v in {**PROD_VARS, **over}.items()]
    return render.resolve_vars(sets, environ=PROD_SECRETS)


@pytest.fixture()
def rendered(tmp_path):
    render.render_all(tmp_path, _vars())
    return tmp_path


# ── 렌더 ────────────────────────────────────────────────────


def test_모든_템플릿이_변수만으로_렌더되고_미해석_토큰이_없다(rendered):
    files = [p for p in rendered.rglob("*") if p.is_file()]
    assert files
    for p in files:
        assert "@@" not in p.read_text(), p


def test_운영_렌더_결과에_dev_흔적이_없다(rendered):
    for p in rendered.rglob("*"):
        if p.is_file():
            body = p.read_text().lower()
            for marker in render.DEV_MARKERS:
                assert marker not in body, (p.name, marker)


def test_livekit_coturn_nginx_값이_운영_변수로_채워진다(rendered):
    lk = (rendered / "etc/livekit/livekit.yaml").read_text()
    assert "node_ip: 203.0.113.10" in lk
    assert "APIprodkey123: prodsecretvalue456" in lk
    assert "port_range_start: 50000" in lk and "tcp_port: 7881" in lk
    turn = (rendered / "etc/turnserver.conf").read_text()
    assert "external-ip=203.0.113.10/10.20.1.10" in turn
    assert "realm=mindbreeze.looxidlabs.com" in turn
    assert "min-port=49152" in turn and "max-port=49200" in turn
    ng = (rendered / "etc/nginx/sites-available/mindbreeze.conf").read_text()
    assert "server_name mindbreeze.looxidlabs.com;" in ng and "server_name api.mindbreeze.looxidlabs.com;" in ng
    assert "/etc/letsencrypt/live/mindbreeze.looxidlabs.com/fullchain.pem" in ng
    assert "location /livekit/" in ng and "proxy_pass http://127.0.0.1:7880/;" in ng
    assert "root /opt/mindbreeze/current/dist;" in ng


def test_시크릿_포함_파일은_제한된_권한으로_쓰인다(rendered):
    assert stat.S_IMODE((rendered / "etc/livekit/livekit.yaml").stat().st_mode) == 0o600
    assert stat.S_IMODE((rendered / "etc/turnserver.conf").stat().st_mode) == 0o640


def test_누락된_변수는_렌더를_중단한다(tmp_path):
    with pytest.raises(render.RenderError, match="PUBLIC_IP"):
        render.render_all(tmp_path, render.resolve_vars(["WEB_HOST=a.example.com", "API_HOST=b.example.com", "PRIVATE_IP=10.0.0.1"], environ=PROD_SECRETS))


def test_시크릿은_set_인자로_받지_않는다():
    with pytest.raises(render.RenderError, match="LIVEKIT_API_SECRET"):
        render.resolve_vars(["LIVEKIT_API_SECRET=x"], environ={})


def test_dev_주소를_변수로_넣으면_운영_렌더가_실패한다(tmp_path):
    with pytest.raises(render.RenderError, match="dev 흔적"):
        render.render_all(tmp_path, _vars(PUBLIC_IP="18.183.86.88"))


def test_dev_허용_옵션으로는_dev_값도_렌더된다(tmp_path):
    render.render_all(tmp_path, _vars(WEB_HOST="dev.mindbreeze.looxidlabs.com", API_HOST="dev-api.mindbreeze.looxidlabs.com"),
                      allow_dev_markers=True)
    assert "dev-api.mindbreeze.looxidlabs.com" in (tmp_path / "etc/nginx/sites-available/mindbreeze.conf").read_text()


# ── 유닛 ────────────────────────────────────────────────────


def test_상시_서비스_유닛은_prod_env_와_릴리스_링크를_사용한다(rendered):
    for name in ("backend", "worker", "email-worker", "export-worker"):
        body = (rendered / f"etc/systemd/system/mindbreeze-{name}.service").read_text()
        assert "EnvironmentFile=/etc/mindbreeze/prod.env" in body
        assert "/opt/mindbreeze/venv/bin/" in body
        assert "WorkingDirectory=/opt/mindbreeze/current/backend" in body
        assert ".env.dev" not in body and "/home/ubuntu" not in body
    backend = (rendered / "etc/systemd/system/mindbreeze-backend.service").read_text()
    assert "--host 127.0.0.1" in backend and "app.main:asgi_app" in backend


def test_공통_작업_서비스는_flock_으로_중복_실행을_막는다(rendered):
    body = (rendered / "etc/systemd/system/mindbreeze-job@.service").read_text()
    assert "flock -n -E 0 /run/lock/mindbreeze-job-%i.lock" in body
    assert "OnFailure=mindbreeze-job-failed@%i.service" in body
    assert "%i_cron.py" in body


# ── jobs.tsv ────────────────────────────────────────────────


DEV_CRON_14 = {
    "cleanup_notifications", "sweep_stale_open_sessions", "sweep_stale_reports", "sweep_session_reminders",
    "sweep_agent_reminders", "sweep_agent_briefings", "process_pipeline_outbox", "process_email_outbox",
    "cleanup_data_exports", "upgrade_narrative_cache", "sweep_stale_eeg_raw", "sweep_stale_media",
    "process_push_outbox", "sweep_agent_checkins",
}


def test_jobs_tsv_는_dev_cron_14개를_활성으로_포함하고_SDD209_2종은_비활성이다():
    jobs = render.load_jobs(DEPLOY / "jobs.tsv")
    enabled = {j["name"] for j in jobs if j["enabled"] == "1"}
    assert enabled == DEV_CRON_14
    disabled = {j["name"] for j in jobs if j["enabled"] == "0"}
    assert disabled == {"retention_sweep", "research_export"}


def test_jobs_tsv_스크립트가_실제로_존재한다():
    for j in render.load_jobs(DEPLOY / "jobs.tsv"):
        assert (BACKEND / j["script"]).is_file(), j["script"]


def test_jobs_tsv_주기가_dev_cron_과_같다():
    jobs = {j["name"]: j["on_calendar"] for j in render.load_jobs(DEPLOY / "jobs.tsv")}
    assert jobs["process_email_outbox"] == "*-*-* *:*:00 UTC"          # * * * * *
    assert jobs["sweep_stale_reports"] == "*-*-* *:00/5:00 UTC"        # */5 * * * *
    assert jobs["cleanup_notifications"] == "*-*-* 04:00:00 UTC"       # 0 4 * * *
    assert jobs["sweep_stale_eeg_raw"] == "*-*-* 04:30:00 UTC"         # 30 4 * * *
    assert jobs["sweep_stale_media"] == "*-*-* 04:45:00 UTC"           # 45 4 * * *
    assert jobs["upgrade_narrative_cache"] == "*-*-* 05:00:00 UTC"     # 0 5 * * *


def test_활성_작업_수만큼_timer_와_타임아웃_드롭인이_생성된다(rendered):
    timers = sorted(p.name for p in (rendered / "etc/systemd/system").glob("mindbreeze-job-*.timer"))
    assert len(timers) == 14
    assert not (rendered / "etc/systemd/system/mindbreeze-job-retention_sweep.timer").exists()
    t = (rendered / "etc/systemd/system/mindbreeze-job-process_email_outbox.timer").read_text()
    assert "Unit=mindbreeze-job@process_email_outbox.service" in t and "Persistent=false" in t
    d = (rendered / "etc/systemd/system/mindbreeze-job@process_email_outbox.service.d/timeout.conf").read_text()
    assert "TimeoutStartSec=55" in d


def test_jobs_tsv_형식_오류를_거부한다(tmp_path):
    bad = tmp_path / "jobs.tsv"
    bad.write_text("name\tscript\ton_calendar\ttimeout_s\tenabled\tnote\nfoo\tbar.py\t*-*-* *:*:00 UTC\t10\t1\tx\n")
    with pytest.raises(render.RenderError):
        render.load_jobs(bad)


# ── 환경 매니페스트 / render_env ────────────────────────────


def _good_params():
    rows = render_env.load_manifest()
    params = {r["key"]: f"v-{r['key'].lower()}" for r in rows if r["source"] == "ssm" and r["required"] == "1"}
    params.update({
        "DATABASE_URL": "postgresql://u:p@mindbreeze-prod.x.ap-northeast-1.rds.amazonaws.com:5432/mindbreeze",
        "FRONTEND_BASE_URL": "https://mindbreeze.looxidlabs.com",
        "REPORT_EMAIL_BASE_URL": "https://mindbreeze.looxidlabs.com",
        "RESEND_FROM_EMAIL": "MIND BREEZE <noreply@mindbreeze.looxidlabs.com>",
        "S3_BUCKET": "mindbreeze-prod",
        "LIVEKIT_HOST": "wss://api.mindbreeze.looxidlabs.com/livekit",
    })
    return params


def test_매니페스트_필수키가_모두_있으면_env_가_생성되고_ENVIRONMENT_가_명시된다():
    text, _ = render_env.build_env(_good_params())
    assert 'ENVIRONMENT="production"' in text
    assert 'S3_USE_INSTANCE_ROLE="true"' in text and 'RETENTION_SWEEP_ENABLED="false"' in text
    assert "AWS_ACCESS_KEY_ID" not in text
    assert 'RESEND_FROM_EMAIL="MIND BREEZE <noreply@mindbreeze.looxidlabs.com>"' in text


def test_env_매니페스트_키가_Settings_필드와_정합한다():
    from app.config import Settings

    fields = {n.upper() for n in Settings.model_fields}
    extra_ok = {"ALERT_SNS_TOPIC_ARN", "DATABASE_URL_SYNC", "AGENT_LLM_MODEL", "DEEPSEEK_API_KEY"}
    for row in render_env.load_manifest():
        assert row["key"] in fields or row["key"] in extra_ok, row["key"]


@pytest.mark.parametrize(
    "mutate,needle",
    [
        (lambda p: p.pop("JWT_SECRET_KEY"), "JWT_SECRET_KEY"),
        (lambda p: p.pop("RESEARCH_ID_KEY_V1"), "RESEARCH_ID_KEY_V1"),
        (lambda p: p.update(AWS_ACCESS_KEY_ID="AKIAX"), "AWS_ACCESS_KEY_ID"),
        (lambda p: p.update(TYPO_KEY="x"), "TYPO_KEY"),
        (lambda p: p.update(ENVIRONMENT="development"), "static"),
        (lambda p: p.update(S3_BUCKET="mindbreeze-dev"), "S3_BUCKET"),
        (lambda p: p.update(FRONTEND_BASE_URL="https://dev.mindbreeze.looxidlabs.com"), "FRONTEND_BASE_URL"),
        (lambda p: p.update(FCM_PROJECT_ID="mb-prod"), "FCM"),
        (lambda p: p.update(VAPID_PUBLIC_KEY="pub"), "VAPID"),
    ],
)
def test_env_렌더는_잘못된_입력을_중단하고_값을_노출하지_않는다(mutate, needle):
    params = _good_params()
    params["JWT_SECRET_KEY"] = "SUPERSECRETJWTVALUE"
    mutate(params)
    with pytest.raises(render_env.EnvRenderError) as exc:
        render_env.build_env(params)
    assert needle in str(exc.value)
    assert "SUPERSECRETJWTVALUE" not in str(exc.value)


def test_env_값의_따옴표와_개행을_안전하게_처리한다():
    assert render_env.quote('a"b\\c') == '"a\\"b\\\\c"'
    with pytest.raises(render_env.EnvRenderError):
        render_env.quote("a\nb")


def test_env_원자적_쓰기는_0600_이다(tmp_path):
    target = tmp_path / "etc" / "prod.env"
    render_env.write_atomic(target, "A=1\n")
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert render_env.check_file(target) == ["ENVIRONMENT 미명시"]


def test_운영_env_의_Settings_가_fail_fast_를_통과한다(monkeypatch):
    """매니페스트로 만든 env 를 실제 Settings 로 읽어 production_config_problems 가 비는지 확인(정합 검증)."""
    from app.config import Settings
    from app.main import production_config_problems

    params = _good_params()
    params.update({
        "CORS_ALLOWED_ORIGINS": "https://mindbreeze.looxidlabs.com,https://api.mindbreeze.looxidlabs.com,https://localhost,capacitor://localhost",
        "LIVEKIT_API_KEY": "prodkey", "LIVEKIT_API_SECRET": "prodsecret",
    })
    text, _ = render_env.build_env(params)
    env = {}
    for ln in text.splitlines():
        if ln and not ln.startswith("#"):
            k, v = ln.split("=", 1)
            env[k] = re.sub(r'^"|"$', "", v)
    for k in list(__import__("os").environ):
        if k.upper() in {n.upper() for n in Settings.model_fields}:
            monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    cfg = Settings(_env_file=None)
    assert production_config_problems(cfg) == []
