#!/usr/bin/env python3
"""SDD-210 비밀값 헬퍼 — boto3 로 직접 호출하여 값이 파일·명령줄·표준출력에 남지 않게 한다.
하위 명령:
  put-random  <name> <kind:alnum|hex|b64url> <len>   # 신규 난수 → SecureString (이미 있으면 건너뜀)
  put-vapid   <public_name> <private_name>           # VAPID P-256 키쌍 생성 → 각각 SecureString
  put-text <name> <value> <String|SecureString> <yes|no(overwrite)>
  put-placeholder <name>                              # 값 'PLACEHOLDER-FILL-ME' 자리표시 (이미 있으면 건너뜀)
  rds-create-empty                                    # SSM 의 DB 계정으로 RDS 생성 (환경변수 RDS_SPEC_JSON 에는 비밀 없는 사양만)
  fingerprint <name>                                  # 값의 SHA-256 앞 12자(비교용)만 출력
"""
import base64, hashlib, json, os, secrets, string, sys
import boto3
from botocore.exceptions import ClientError

PROFILE = os.environ.get("MB_PROFILE", "looxid-las")
REGION = os.environ.get("MB_REGION", "ap-northeast-1")
PREFIX = "/mindbreeze/prod"
TAGS = [{"Key": "project", "Value": "mindbreeze"}, {"Key": "env", "Value": "prod"}]
sess = boto3.Session(profile_name=PROFILE, region_name=REGION)
ssm = sess.client("ssm")
kms_id = open(os.path.join(os.environ.get("MB_STATE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".state")), "kms_key_id")).read().strip()


def exists(name):
    try:
        ssm.get_parameter(Name=f"{PREFIX}/{name}")
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ParameterNotFound":
            return False
        raise


def put(name, value):
    ssm.put_parameter(Name=f"{PREFIX}/{name}", Value=value, Type="SecureString", KeyId=kms_id, Tags=TAGS)


def rand(kind, n):
    if kind == "alnum":
        return "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(n))
    if kind == "hex":
        return secrets.token_hex((n + 1) // 2)[:n]
    return secrets.token_urlsafe(n)[:n]


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "put-random":
        name, kind, n = args[0], args[1], int(args[2])
        if exists(name):
            print(f"존재: {name} (건너뜀)"); return
        put(name, rand(kind, n)); print(f"생성: {name} (SecureString, {n}자)")
    elif cmd == "put-vapid":
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
        pub_n, prv_n = args
        if exists(pub_n) and exists(prv_n):
            print("존재: VAPID 키쌍 (건너뜀)"); return
        k = ec.generate_private_key(ec.SECP256R1())
        raw_pub = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        raw_prv = k.private_numbers().private_value.to_bytes(32, "big")
        b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
        for n, v in ((pub_n, b64(raw_pub)), (prv_n, b64(raw_prv))):
            if not exists(n):
                put(n, v)
        print(f"생성: {pub_n}, {prv_n} (SecureString)")
    elif cmd == "put-text":   # 비밀 아닌 값(호스트·플래그). awscli 는 https:// 값을 URL 로 가져오려 하므로 boto3 로 직접 기록
        name, value, typ, overwrite = args
        if exists(name) and overwrite != "yes":
            print(f"존재: {name} (건너뜀)"); return
        kw = dict(Name=f"{PREFIX}/{name}", Value=value, Type=typ, Overwrite=(overwrite == "yes"))
        if typ == "SecureString":
            kw["KeyId"] = kms_id
        if overwrite != "yes":
            kw["Tags"] = TAGS
        ssm.put_parameter(**kw); print(f"기록: {name} ({typ})")
    elif cmd == "put-placeholder":
        if exists(args[0]):
            print(f"존재: {args[0]} (건너뜀)"); return
        put(args[0], "PLACEHOLDER-FILL-ME"); print(f"자리표시: {args[0]}")
    elif cmd == "rds-create-empty":
        spec = json.loads(os.environ["RDS_SPEC_JSON"])
        g = lambda n: ssm.get_parameter(Name=f"{PREFIX}/{n}", WithDecryption=True)["Parameter"]["Value"]
        spec["MasterUsername"], spec["MasterUserPassword"] = g("DB_USER"), g("DB_PASSWORD")
        r = sess.client("rds").create_db_instance(**spec)["DBInstance"]
        print(r["DBInstanceIdentifier"], r["DBInstanceStatus"])
    elif cmd == "fingerprint":
        v = ssm.get_parameter(Name=f"{PREFIX}/{args[0]}", WithDecryption=True)["Parameter"]["Value"]
        print(hashlib.sha256(v.encode()).hexdigest()[:12])
    else:
        sys.exit("unknown cmd")


main()
