import importlib.util
from pathlib import Path

_p = Path(__file__).resolve().parents[2] / "scripts" / "beta-apk-prepare.py"
_s = importlib.util.spec_from_file_location("beta_apk_prepare", _p)
m = importlib.util.module_from_spec(_s)
_s.loader.exec_module(m)

BADGING = "package: name='com.looxidlabs.mindbreeze2' versionCode='24' versionName='1.0.3' platformBuildVersionName='15'\nsdkVersion:'26'\n"
CERT = "Signer #1 certificate SHA-256 digest: " + "AB" * 32 + "\n"


def test_parse():
    info = m.parse_badging(BADGING)
    assert info == {"package": "com.looxidlabs.mindbreeze2", "versionCode": 24, "versionName": "1.0.3", "debuggable": False}
    assert m.parse_cert_sha256(CERT) == "ab" * 32
    assert m.parse_badging(BADGING + "application-debuggable\n")["debuggable"] is True


def test_validate():
    info = m.parse_badging(BADGING)
    cert = "ab" * 32
    assert m.validate(info, cert, 24, cert) == []
    assert m.validate({**info, "versionCode": 23}, cert, 24, None)
    assert m.validate({**info, "package": "com.looxidlabs.mindbreeze2.dev"}, cert, 24, None)
    assert m.validate(info, cert, 24, "cd" * 32)
    assert m.validate(info, cert, 24, ("AB:" * 32)[:-1]) == []
    assert m.validate({**info, "debuggable": True}, cert, 24, None)


def test_build_config():
    base = {"schemaVersion": 1, "updateBannerEnabled": False, "android": {}}
    cfg = m.build_config(base, m.parse_badging(BADGING), "https://x/a.apk", "f" * 64, 100, "2026-11-01")
    assert cfg["android"]["versionCode"] == 24 and cfg["android"]["apkUrl"] == "https://x/a.apk"
    assert base["android"] == {}
