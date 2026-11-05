#!/usr/bin/env python3
"""베타 APK 검수 + beta.json 갱신본 생성 (SDD-254). 업로드는 하지 않는다.

Play Console 에서 받은 '구글 서명 유니버설 APK' 를 입력으로 받아 다음을 점검한다.
  - 패키지명 com.looxidlabs.mindbreeze2 (dev 접미사 아님), versionCode >= 최소값(기본 24), debuggable 아님
  - 서명 인증서 SHA-256 (--expect-cert 로 Play 앱 서명 키 지문과 대조)
  - 파일 SHA-256·크기
통과하면 beta.json 갱신본을 --out 에 쓴다(실제 게시는 별도 승인 후 수동).
사용: beta-apk-prepare.py app.apk --apk-url https://… --expect-cert <SHA256> [--base public/beta.json] [--out out/beta.json]
필요 도구: aapt2 또는 aapt, apksigner (Android build-tools). 없으면 명확히 실패한다.
"""
from __future__ import annotations
import argparse, hashlib, json, re, shutil, subprocess, sys
from pathlib import Path

PACKAGE = "com.looxidlabs.mindbreeze2"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def parse_badging(text: str) -> dict:
    m = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", text)
    if not m:
        raise ValueError("aapt badging 에서 패키지 정보를 찾지 못했습니다")
    return {"package": m.group(1), "versionCode": int(m.group(2)), "versionName": m.group(3),
            "debuggable": "application-debuggable" in text}


def parse_cert_sha256(text: str) -> str:
    m = re.search(r"certificate SHA-256 digest: ([0-9a-fA-F]{64})", text)
    if not m:
        raise ValueError("apksigner 출력에서 인증서 지문을 찾지 못했습니다")
    return m.group(1).lower()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(info: dict, cert: str, min_code: int, expect_cert: str | None) -> list[str]:
    errs = []
    if info["package"] != PACKAGE:
        errs.append(f"패키지명 불일치: {info['package']} (기대 {PACKAGE})")
    if info["versionCode"] < min_code:
        errs.append(f"versionCode {info['versionCode']} < 최소 {min_code}")
    if info["debuggable"]:
        errs.append("debuggable 빌드는 배포 불가")
    if expect_cert and cert != expect_cert.replace(":", "").lower():
        errs.append("서명 인증서 지문이 Play 앱 서명 키와 다름 (추후 Play 업데이트 불가)")
    return errs


def build_config(base: dict, info: dict, apk_url: str, sha: str, size: int, today: str) -> dict:
    cfg = json.loads(json.dumps(base))
    cfg["updatedAt"] = today
    cfg["android"] = {"versionName": info["versionName"], "versionCode": info["versionCode"],
                      "apkUrl": apk_url, "sha256": sha, "sizeBytes": size, "publishedAt": today}
    return cfg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("apk")
    ap.add_argument("--apk-url", required=True)
    ap.add_argument("--min-version-code", type=int, default=24)
    ap.add_argument("--expect-cert")
    ap.add_argument("--base", default="frontend/public/beta.json")
    ap.add_argument("--out", default="out/beta.json")
    a = ap.parse_args()
    if not a.apk_url.startswith("https://"):
        print("apk-url 은 https 여야 합니다", file=sys.stderr); return 2
    apk = Path(a.apk)
    aapt = shutil.which("aapt2") or shutil.which("aapt")
    signer = shutil.which("apksigner")
    if not aapt or not signer:
        print("aapt2/aapt 와 apksigner(Android build-tools)가 필요합니다", file=sys.stderr); return 2
    info = parse_badging(run([aapt, "dump", "badging", str(apk)]))
    cert = parse_cert_sha256(run([signer, "verify", "--print-certs", str(apk)]))
    errs = validate(info, cert, a.min_version_code, a.expect_cert)
    print(json.dumps({**info, "certSha256": cert}, ensure_ascii=False))
    if errs:
        print("\n".join("실패: " + e for e in errs), file=sys.stderr); return 1
    from datetime import date
    base = json.loads(Path(a.base).read_text())
    cfg = build_config(base, info, a.apk_url, sha256_file(apk), apk.stat().st_size, date.today().isoformat())
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
    print(f"검수 통과 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
