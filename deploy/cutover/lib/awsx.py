#!/usr/bin/env python3
"""SDD-210 컷오버 — boto3 직접 호출 헬퍼. **시크릿 값은 출력·로그·명령줄에 남기지 않는다.**

하위 명령:
  ssm-run <instance-id> <timeout-sec>        stdin 스크립트를 AWS-RunShellScript 로 실행. 원격 stdout/stderr 를 그대로 출력, 종료 코드=원격 종료 코드
  rds-reset-master-password <db-id>          SSM /mindbreeze/prod/DB_PASSWORD → 인스턴스 마스터 비밀번호 재설정(값 비출력)
  ssm-put-host <name> <value>                비밀 아닌 값(DB_HOST 등)을 SecureString 으로 기록(overwrite). 허용 이름: DB_HOST, DB_NAME
  ssm-get-plain <name>                       비밀 아닌 값만 조회·출력(허용: CORS_ALLOWED_ORIGINS, DB_HOST, DB_NAME)
  ssm-remove-cors-origin <origin>            CORS_ALLOWED_ORIGINS 에서 해당 오리진 제거 후 목록 출력(오리진은 비밀 아님)
  ssm-check-required <env-manifest.tsv>      필수 ssm 키 누락·자리표시 점검(키 이름만 출력). 문제가 있으면 종료 코드 1
"""
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError

PROFILE = os.environ.get("MB_PROFILE", "looxid-las")
REGION = os.environ.get("MB_REGION", "ap-northeast-1")
PREFIX = "/mindbreeze/prod"
PLACEHOLDER = "PLACEHOLDER-FILL-ME"
KMS_ALIAS = "alias/mindbreeze-prod"
TAGS = [{"Key": "project", "Value": "mindbreeze"}, {"Key": "env", "Value": "prod"}]
sess = boto3.Session(profile_name=PROFILE, region_name=REGION)
ssm = sess.client("ssm")


def get_param(name: str, decrypt: bool = True):
    try:
        return ssm.get_parameter(Name=f"{PREFIX}/{name}", WithDecryption=decrypt)["Parameter"]["Value"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "ParameterNotFound":
            return None
        raise


def put_param(name: str, value: str) -> None:
    exists = get_param(name, decrypt=False) is not None
    kw = dict(Name=f"{PREFIX}/{name}", Value=value, Type="SecureString", KeyId=KMS_ALIAS, Overwrite=exists)
    if not exists:
        kw["Tags"] = TAGS
    ssm.put_parameter(**kw)


def cmd_ssm_run(iid: str, timeout: int) -> int:
    script = sys.stdin.read()
    r = ssm.send_command(
        InstanceIds=[iid], DocumentName="AWS-RunShellScript", TimeoutSeconds=max(60, timeout),
        Comment="mindbreeze cutover", Parameters={"commands": [script], "executionTimeout": [str(timeout)]},
    )
    cid = r["Command"]["CommandId"]
    deadline = time.time() + timeout + 90
    inv = {}
    while time.time() < deadline:
        time.sleep(3)
        try:
            inv = ssm.get_command_invocation(CommandId=cid, InstanceId=iid)
        except ClientError as e:
            if e.response["Error"]["Code"] == "InvocationDoesNotExist":
                continue
            raise
        if inv.get("Status") in ("Success", "Failed", "TimedOut", "Cancelled"):
            break
    sys.stdout.write(inv.get("StandardOutputContent", ""))
    err = inv.get("StandardErrorContent", "")
    if err:
        sys.stderr.write(err)
    if inv.get("Status") == "Success":
        return 0
    code = inv.get("ResponseCode", 1)
    sys.stderr.write(f"[ssm] 상태={inv.get('Status')} 종료코드={code}\n")
    return code if isinstance(code, int) and 0 < code < 256 else 1


def cmd_reset_password(db_id: str) -> int:
    pw = get_param("DB_PASSWORD")
    if not pw or pw == PLACEHOLDER:
        sys.exit("SSM DB_PASSWORD 없음")
    rds = sess.client("rds")
    rds.modify_db_instance(DBInstanceIdentifier=db_id, MasterUserPassword=pw, ApplyImmediately=True)
    print(f"마스터 비밀번호 재설정 요청: {db_id} (값 비출력)")
    return 0


def cmd_put_host(name: str, value: str) -> int:
    if name not in ("DB_HOST", "DB_NAME"):
        sys.exit("허용되지 않은 이름")
    put_param(name, value)
    print(f"기록: {name} (SecureString)")
    return 0


def cmd_get_plain(name: str) -> int:
    if name not in ("CORS_ALLOWED_ORIGINS", "DB_HOST", "DB_NAME"):
        sys.exit("허용되지 않은 이름")
    print(get_param(name) or "")
    return 0


def cmd_remove_cors(origin: str) -> int:
    cur = get_param("CORS_ALLOWED_ORIGINS") or ""
    items = [o.strip() for o in cur.split(",") if o.strip()]
    kept = [o for o in items if o != origin]
    if len(kept) == len(items):
        print(f"변경 없음: {origin} 는 목록에 없음")
        print(",".join(kept))
        return 0
    if not kept:
        sys.exit("제거 후 목록이 비어 중단")
    put_param("CORS_ALLOWED_ORIGINS", ",".join(kept))
    print(f"제거: {origin}")
    print(",".join(kept))
    return 0


def cmd_check_required(manifest: str) -> int:
    bad = []
    with open(manifest, encoding="utf-8") as fh:
        rows = [ln.rstrip("\n").split("\t") for ln in fh if ln.strip() and not ln.startswith("#")]
    header, body = rows[0], rows[1:]
    idx = {h: i for i, h in enumerate(header)}
    for r in body:
        r += [""] * (len(header) - len(r))
        key, source, required = r[idx["key"]], r[idx["source"]], r[idx["required"]]
        if source != "ssm" or required != "1" or key in ("DATABASE_URL", "DATABASE_URL_SYNC"):
            continue
        v = get_param(key)
        if v is None:
            bad.append(f"{key}: 없음")
        elif v == PLACEHOLDER:
            bad.append(f"{key}: 자리표시(미채움)")
    for k in ("DB_USER", "DB_PASSWORD", "DB_NAME"):
        v = get_param(k)
        if not v or v == PLACEHOLDER:
            bad.append(f"{k}: 없음/자리표시")
    for b in bad:
        print(b)
    print(f"점검 결과: 문제 {len(bad)}건")
    return 1 if bad else 0


def main() -> int:
    c, a = sys.argv[1], sys.argv[2:]
    if c == "ssm-run":
        return cmd_ssm_run(a[0], int(a[1]))
    if c == "rds-reset-master-password":
        return cmd_reset_password(a[0])
    if c == "ssm-put-host":
        return cmd_put_host(a[0], a[1])
    if c == "ssm-get-plain":
        return cmd_get_plain(a[0])
    if c == "ssm-remove-cors-origin":
        return cmd_remove_cors(a[0])
    if c == "ssm-check-required":
        return cmd_check_required(a[0])
    sys.exit("unknown cmd")


if __name__ == "__main__":
    sys.exit(main())
