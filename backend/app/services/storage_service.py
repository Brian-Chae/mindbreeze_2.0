"""SDD-027 T3 — S3 프리사인드 URL 발급 헬퍼.

raw EEG 청크는 서버를 거치지 않고 클라이언트가 S3 로 직접 PUT 한다(아키텍처 규칙: S3 프리사인드).
자격증명이 없는 로컬/테스트 환경에서는 결정적 스텁 URL 을 반환해 흐름을 검증 가능하게 한다
(실제 업로드는 배포 환경 자격증명이 있을 때 동작한다).
"""

import base64
import hashlib
import logging
import threading
from datetime import datetime, timezone

from app.config import settings

logger = logging.getLogger(__name__)

# TLS 필수(데이터 프라이버시 규칙) — 스텁 URL 도 https 로 구성한다.
_STUB_HOST = f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com"

# STG-07: 개발/템플릿에 박힌 더미 자격증명. 이 값을 실제 자격증명으로 오인하면
#   storage_configured()=True 가 되어 스텁 폴백이 꺼지고, 존재하지 않는 버킷·키로
#   실제 AWS 서명/업로드를 시도해 조용히 실패한다. 더미는 '미설정'으로 취급한다.
_DUMMY_CREDENTIALS = {"dev", "test", "dummy", "changeme", "minio", "minioadmin", "local", "example"}

# STG-10: presigned PUT 유효기간 — 기본 1시간은 과도하게 길고 상한이 없어 URL 유출 시 악용 창이
#   넓다. raw EEG 업로드는 발급 직후 수행되므로 기본 10분, 상한 15분으로 축소한다.
PRESIGNED_PUT_DEFAULT_EXPIRES_IN = 600
PRESIGNED_PUT_MAX_EXPIRES_IN = 900


class StorageUploadError(RuntimeError):
    """STG-12: 프로덕션에서 S3 업로드가 실패했는데 조용히 로컬 폴백하는 것을 금지한다.

    운영 환경에서 로컬 폴백은 (a) 사용자에게 성공으로 보이지만 실제 S3 객체가 없고,
    (b) 다중 인스턴스에서 파일이 유실되는 원인이 된다. 설정된 S3 업로드 실패는 숨기지 않는다.
    """


class StorageSigningError(RuntimeError):
    """자격증명이 설정된 배포 환경에서 presigned 서명이 실패했을 때 발생한다.

    스텁 URL 로 조용히 폴백하면 클라이언트가 실제로는 PUT 불가한 가짜 URL 을 받아
    업로드가 유실되므로, 자격증명이 있는 환경에서는 실패를 숨기지 않고 전파한다.
    """


def _credential_kwargs() -> dict[str, str]:
    """boto3.client 자격증명 인자. 키가 비어 있으면 인자를 생략해 기본 자격 체인(인스턴스 역할)을 쓴다.

    SDD-210(T-D3): 빈 문자열을 그대로 넘기면 boto3 가 빈 키로 서명을 시도해 실패한다. 키가 있으면 기존과 동일.
    """
    key = (settings.aws_access_key_id or "").strip()
    secret = (settings.aws_secret_access_key or "").strip()
    if key and secret:
        return {"aws_access_key_id": settings.aws_access_key_id, "aws_secret_access_key": settings.aws_secret_access_key}
    return {}


def _has_real_credentials() -> bool:
    """실제 S3 자격증명이 설정되었는지(더미 아님) 판정한다.

    SDD-210: S3_USE_INSTANCE_ROLE=true 면 키 없이도 설정된 것으로 본다(EC2 인스턴스 역할). 키가 함께
    있으면 아래 기존 판정을 따른다.

    STG-07: dev 더미(dev/dev 등)는 실제 서명이 불가하므로 미설정으로 본다 — 스텁 유지.
    """
    key = (settings.aws_access_key_id or "").strip()
    secret = (settings.aws_secret_access_key or "").strip()
    if not key and not secret and getattr(settings, "s3_use_instance_role", False):
        return True
    if not key or not secret:
        return False
    if key.lower() in _DUMMY_CREDENTIALS and secret.lower() in _DUMMY_CREDENTIALS:
        return False
    return True


def _endpoint_url() -> str | None:
    """STG-06: 설정된 S3 호환 엔드포인트. 미설정이면 None(AWS 표준)."""
    url = (getattr(settings, "s3_endpoint_url", "") or "").strip()
    return url or None


def should_fail_on_upload_failure() -> bool:
    """STG-12: 업로드 실패를 로컬 폴백으로 숨기지 않고 명시적으로 실패시켜야 하는지.

    실제 S3 자격증명이 설정된 경우 환경(dev/prod)과 무관하게 True. SDD-197: dev 가 실사용자를
    받는 동안 업로드 실패가 로컬 폴백으로 조용히 묻히지 않게 한다. 자격증명 미설정/더미(테스트·
    로컬 개발)는 기존 로컬 폴백을 유지한다.
    """
    return _has_real_credentials()


def _stub_url(object_key: str) -> str:
    return f"{_STUB_HOST}/{object_key}?stub=1"


def storage_configured() -> bool:
    """S3 자격증명이 설정되어 실제 서명/조회가 가능한지 여부.

    미설정(로컬/테스트)·더미 자격증명(STG-07) 환경은 스텁으로 흐름만 검증하며,
    검증·서명 실패를 실제 오류로 취급하지 않는다.
    """
    return _has_real_credentials()


def generate_presigned_put(
    object_key: str,
    *,
    content_type: str = "application/octet-stream",
    expires_in: int = PRESIGNED_PUT_DEFAULT_EXPIRES_IN,
) -> str:
    """S3 PUT 프리사인드 URL 을 발급한다.

    - 자격증명 미설정(로컬/테스트): 실제 서명이 불가하므로 결정적 스텁 URL 을 반환한다(현행 유지).
    - 자격증명 설정(배포): 서명 실패를 스텁으로 숨기지 않고 StorageSigningError 로 전파한다.
    - STG-10: 유효기간은 항상 1초~상한(15분)으로 클램프한다.
    """
    # STG-10: 호출측이 큰 값을 넘겨도 상한을 넘기지 못하게 한다.
    expires_in = max(1, min(int(expires_in), PRESIGNED_PUT_MAX_EXPIRES_IN))
    if not storage_configured():
        # 자격증명 미설정 — 로컬/테스트. 실제 서명 없이 스텁 URL 반환.
        return _stub_url(object_key)
    try:
        import boto3

        # boto3 가 region_name 만으로는 virtual-hosted presigned URL 을 us-east-1(s3.amazonaws.com)로
        # 잘못 생성해 307 리다이렉트가 나는 문제(SDD-027 후속)가 있어, 리전 endpoint 를 명시해 고정한다.
        # STG-06: s3_endpoint_url 이 설정되면(MinIO 등) 그 엔드포인트를 우선 사용한다.
        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=_endpoint_url() or f"https://s3.{settings.s3_region}.amazonaws.com",
            **_credential_kwargs(),
        )
        return client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": object_key,
                "ContentType": content_type,
                # EEG-STO-01: raw EEG(민감 데이터) presigned PUT 에도 서버측 암호화를 강제한다.
                # 이 값을 서명 파라미터에 포함하면 클라이언트가 같은 헤더를 보내야 PUT 이 성사되어,
                # 평문 저장이 원천 차단된다(upload_bytes/upload_file 의 SSE 와 동일 정책).
                "ServerSideEncryption": "AES256",
            },
            ExpiresIn=expires_in,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("[storage] presigned 발급 실패(자격증명 설정됨), 스텁 폴백 금지: %s", exc)
        raise StorageSigningError("presigned_url_failed") from exc


def verify_object(object_key: str, *, expected_size: int | None = None) -> bool | None:
    """S3 객체 존재(및 크기 일치)를 HEAD 로 검증한다(ack 확정 전 무결성 게이트).

    반환값:
      - None: 자격증명 미설정 → 검증 불가(스텁 환경, 건너뜀). 기존 로컬/테스트 흐름 유지.
      - True: 객체 존재(및 expected_size 지정 시 크기 일치).
      - False: 객체 없음/크기 불일치/조회 실패(자격증명 설정됨) → 호출측이 failed 로 마킹.
    """
    if not storage_configured():
        return None
    try:
        client = _s3_client()
        if client is None:
            # 자격증명은 있으나 클라이언트 생성 실패 — 검증 불가를 성공으로 치지 않는다.
            return False
        resp = client.head_object(Bucket=settings.s3_bucket, Key=object_key)
        if expected_size is not None and int(resp.get("ContentLength", -1)) != int(expected_size):
            logger.warning("[storage] S3 객체 크기 불일치: %s", object_key)
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 HEAD 검증 실패: %s (%s)", object_key, exc)
        return False


def _b64_sha256(hex_digest: str) -> str:
    return base64.b64encode(bytes.fromhex(hex_digest)).decode()


def generate_presigned_put_checksummed(
    object_key: str,
    *,
    checksum_sha256_hex: str,
    content_type: str = "application/octet-stream",
    expires_in: int = PRESIGNED_PUT_DEFAULT_EXPIRES_IN,
) -> tuple[str, dict[str, str]]:
    """SDD-244: SHA-256 을 서명 헤더에 바인딩한 PUT URL 과 클라이언트가 그대로 보내야 할 헤더.

    SigV4 로 content-type · x-amz-checksum-sha256 · x-amz-server-side-encryption 을 서명한다.
    저장소가 body 의 실제 SHA-256 을 검증하므로 유효 URL 을 재사용해도 다른 바이트는 거절된다.
    객체 key 에 hash 가 들어 있어(내용 주소) 같은 key 는 같은 바이트만 가질 수 있다.
    자격증명 미설정(스텁)은 같은 헤더 계약의 스텁 URL 을 돌려준다.
    """
    expires_in = max(1, min(int(expires_in), PRESIGNED_PUT_MAX_EXPIRES_IN))
    headers = {
        "Content-Type": content_type,
        "x-amz-server-side-encryption": "AES256",
        "x-amz-checksum-sha256": _b64_sha256(checksum_sha256_hex),
    }
    if not storage_configured():
        return _stub_url(object_key), headers
    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=_endpoint_url() or f"https://s3.{settings.s3_region}.amazonaws.com",
            config=Config(signature_version="s3v4"),
            **_credential_kwargs(),
        )
        url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": object_key,
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
                "ChecksumSHA256": headers["x-amz-checksum-sha256"],
            },
            ExpiresIn=expires_in,
        )
        return url, headers
    except Exception as exc:  # noqa: BLE001
        logger.error("[storage] checksum presigned 발급 실패, 스텁 폴백 금지: %s", exc)
        raise StorageSigningError("presigned_url_failed") from exc


def verify_object_sha256(
    object_key: str, *, expected_size: int, expected_sha256_hex: str
) -> tuple[bool | None, str | None]:
    """ACK 확정 전 객체의 존재·크기·SHA-256 을 검증한다. 반환 (결과, object version id).

    - (None, None): 자격증명 미설정 → 검증 불가(스텁/테스트). 호출측이 운영 의미를 결정한다.
    - (True, version): HEAD 크기 일치 + 저장소 SHA-256(ChecksumSHA256) 일치, 또는 저장소 체크섬이 없으면
      서버가 스트리밍으로 읽어 계산한 SHA-256 일치. ETag 는 SHA-256 이 아니므로 사용하지 않는다.
    - (False, None): 객체 없음/크기·해시 불일치/조회 실패.
    """
    if not storage_configured():
        return None, None
    try:
        client = _s3_client()
        if client is None:
            return False, None
        head = client.head_object(Bucket=settings.s3_bucket, Key=object_key, ChecksumMode="ENABLED")
        if int(head.get("ContentLength", -1)) != int(expected_size):
            logger.warning("[storage] v2 객체 크기 불일치: %s", object_key)
            return False, None
        version = head.get("VersionId")
        stored = head.get("ChecksumSHA256")
        if stored:
            ok = stored == _b64_sha256(expected_sha256_hex)
            return (True, version) if ok else (False, None)
        digest = hashlib.sha256()
        body = client.get_object(Bucket=settings.s3_bucket, Key=object_key)["Body"]
        try:
            for piece in iter(lambda: body.read(65536), b""):
                digest.update(piece)
        finally:
            body.close()
        return (True, version) if digest.hexdigest() == expected_sha256_hex else (False, None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] v2 객체 검증 실패: %s (%s)", object_key, exc)
        return False, None


# STG-14: 자격증명 회전·설정 변경을 반영하기 위해 클라이언트를 '설정 지문' 기준으로 캐시한다.
#   @lru_cache(maxsize=1) 로 프로세스당 영구 고정하면 자격증명/엔드포인트가 바뀌어도 이전
#   클라이언트가 계속 재사용돼 회전 자격증명이 반영되지 않는다(인증 실패·폐기 자격증명 잔존).
_s3_client_lock = threading.Lock()
_s3_client_state = None  # (fingerprint, client) — 설정 지문이 바뀌면 재생성


def _s3_client_fingerprint() -> tuple:
    """클라이언트 캐시 키 — 리전·엔드포인트·키 ID·비밀값 해시(비밀 원문은 보관·노출하지 않는다)."""
    return (
        settings.s3_region,
        _endpoint_url() or "",
        settings.aws_access_key_id or "",
        hashlib.sha256((settings.aws_secret_access_key or "").encode()).hexdigest(),
        bool(getattr(settings, "s3_use_instance_role", False)),
    )


def _s3_client():
    """S3 클라이언트 — 설정(자격증명·엔드포인트·리전) 지문 기준 캐시.

    boto3 client는 스레드 안전하므로 병렬 다운로드/업로드에서 공유해도 안전하다.
    자격증명 미설정(또는 더미, STG-07) 시 None 을 반환한다(호출부가 로컬 폴백 결정).
    STG-06: s3_endpoint_url 설정 시 해당 엔드포인트(MinIO 등)로 연결한다.
    STG-14: 설정 지문이 바뀌면(자격증명 회전 등) 새 클라이언트를 생성해 반영한다.
    """
    global _s3_client_state
    if not _has_real_credentials():
        return None
    fingerprint = _s3_client_fingerprint()
    state = _s3_client_state
    if state is not None and state[0] == fingerprint:
        return state[1]
    try:
        import boto3

        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=_endpoint_url(),
            **_credential_kwargs(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 클라이언트 생성 실패: %s", exc)
        return None
    with _s3_client_lock:
        _s3_client_state = (fingerprint, client)
    return client


def open_object_stream(object_key: str):
    """STG-08: S3 객체를 스트리밍용 file-like(Body)로 연다 — 전량 메모리 적재 금지.

    자격증명 미설정/조회 실패 시 None 을 반환한다(호출부가 누락 청크로 판정).
    호출측은 반드시 close() 해야 한다.
    """
    if not _has_real_credentials():
        return None
    client = _s3_client()
    if client is None:
        return None
    try:
        resp = client.get_object(Bucket=settings.s3_bucket, Key=object_key)
        return resp["Body"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 스트림 열기 실패: %s (%s)", object_key, exc)
        return None


def upload_bytes(
    object_key: str,
    content: bytes,
    *,
    content_type: str = "application/octet-stream",
) -> bool:
    """바이트를 S3 에 직접 업로드한다(SDD-084 영상 청크 등 서버 경유 업로드용).

    자격증명 미설정/실패 시 False 를 반환한다 — 호출부가 로컬 폴백을 결정한다
    (기존 audio 청크와 동일하게 로컬 저장으로 흐름을 유지 가능하게).
    """
    if not _has_real_credentials():
        return False
    try:
        client = _s3_client()
        if client is None:
            return False
        # 민감 데이터(상담 영상) — 서버사이드 암호화 필수(데이터 프라이버시 규칙)
        client.put_object(
            Bucket=settings.s3_bucket,
            Key=object_key,
            Body=content,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 업로드 실패, 로컬 폴백: %s", exc)
        return False


def download_bytes(object_key: str) -> bytes | None:
    """S3 에서 object 를 다운로드한다. 자격증명 미설정/실패 시 None (로컬 폴백용)."""
    if not _has_real_credentials():
        return None
    try:
        client = _s3_client()
        if client is None:
            return None
        resp = client.get_object(Bucket=settings.s3_bucket, Key=object_key)
        return resp["Body"].read()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 다운로드 실패: %s", exc)
        return None


def upload_file(
    path: str,
    object_key: str,
    *,
    content_type: str = "video/webm",
) -> bool:
    """로컬 파일을 S3 에 스트리밍(멀티파트) 업로드한다.

    upload_bytes 와 달리 전체 파일을 메모리에 올리지 않고 boto3 upload_file 이
    자동 멀티파트로 디스크에서 직접 읽어 올린다(대용량 병합 영상 업로드용).
    자격증명 미설정/실패 시 False 를 반환한다.
    """
    if not _has_real_credentials():
        return False
    try:
        client = _s3_client()
        if client is None:
            return False
        client.upload_file(
            path,
            settings.s3_bucket,
            object_key,
            ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 파일 업로드 실패, 로컬 폴백: %s", exc)
        return False


class ExportStorageError(RuntimeError):
    """내보내기 저장소는 미설정·실패를 성공 URL로 대체하지 않는다."""


def _export_client():
    if not _has_real_credentials():
        raise ExportStorageError('storage_not_configured')
    try:
        import boto3
        from botocore.config import Config
        return boto3.client(
            's3', region_name=settings.s3_region,
            endpoint_url=_endpoint_url(),
            **_credential_kwargs(),
            config=Config(signature_version='s3v4', connect_timeout=10, read_timeout=60, retries={'max_attempts': 2}),
        )
    except Exception as exc:
        raise ExportStorageError('storage_unavailable') from exc


def upload_export(path: str, object_key: str) -> None:
    try:
        _export_client().upload_file(path, settings.s3_bucket, object_key, ExtraArgs={
            'ContentType': 'application/zip', 'ServerSideEncryption': 'AES256',
            'ContentDisposition': 'attachment; filename="mindbreeze-data.zip"',
        })
    except Exception as exc:
        raise ExportStorageError('upload_failed') from exc


def generate_presigned_get(
    object_key: str,
    *,
    expires_in: int = 300,
    expires_at: datetime | None = None,
    content_type: str = "application/zip",
    content_disposition: str | None = 'attachment; filename="mindbreeze-data.zip"',
) -> str:
    """S3 GET 프리사인드 URL 을 발급한다 (데이터 익스포트/영상 리플레이 공용).

    content_type/content_disposition 은 객체 종류에 따라 오버라이드한다:
      - 데이터 익스포트(zip): 기본값(application/zip + attachment) 유지.
      - 영상 리플레이: content_type="video/webm", content_disposition=None.
        attachment 로 발급하면 <video> 태그가 재생하지 못하고 다운로드를 시도한다.
    """
    if not 1 <= expires_in <= 300:
        raise ExportStorageError('invalid_expiry')
    try:
        client = _export_client()
        client.head_object(Bucket=settings.s3_bucket, Key=object_key)
        if expires_at is not None:
            expires_in = min(expires_in, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
            if expires_in < 1:
                raise ExportStorageError('package_expired')
        params = {'Bucket': settings.s3_bucket, 'Key': object_key}
        if content_type:
            params['ResponseContentType'] = content_type
        if content_disposition:
            params['ResponseContentDisposition'] = content_disposition
        return client.generate_presigned_url('get_object', Params=params, ExpiresIn=expires_in)
    except Exception as exc:
        raise ExportStorageError('presign_failed') from exc


def delete_object(object_key: str) -> bool:
    """S3 객체를 삭제한다 — 보관 기간 경과 raw 정리(EEG-RET-01) 등 best-effort 용도.

    자격증명 미설정(로컬/테스트) 환경에서는 삭제할 실제 객체가 없으므로 False 를 반환한다
    (DB 정리는 계속 진행되어야 하므로 예외를 올리지 않는다).
    """
    client = _s3_client()
    if client is None:
        return False
    try:
        client.delete_object(Bucket=settings.s3_bucket, Key=object_key)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 객체 삭제 실패: %s (%s)", object_key, exc)
        return False


def delete_object_everywhere(object_key: str) -> bool:
    """SDD-220: 사용자 영구 삭제용 — 모든 버전(delete marker 포함)과 진행 중 multipart 잔여물까지 지운다.

    버저닝 버킷에서 delete_object 는 delete marker 만 만들 뿐 이전 버전이 남는다.
    자격증명이 없으면 지울 객체가 없으므로 True(멱등 성공)를 돌려준다. 일부라도 실패하면 예외를 올려 호출자가 재시도하게 한다.
    """
    client = _s3_client()
    if client is None:
        return True
    bucket = settings.s3_bucket
    key_marker = version_marker = None
    while True:
        params: dict = {"Bucket": bucket, "Prefix": object_key}
        if key_marker:
            params.update(KeyMarker=key_marker, VersionIdMarker=version_marker)
        page = client.list_object_versions(**params)
        targets = [
            {"Key": v["Key"], "VersionId": v["VersionId"]}
            for v in [*page.get("Versions", []), *page.get("DeleteMarkers", [])]
            if v["Key"] == object_key
        ]
        if targets:
            result = client.delete_objects(Bucket=bucket, Delete={"Objects": targets, "Quiet": True})
            if result.get("Errors"):
                raise RuntimeError("s3_version_delete_failed")
        if not page.get("IsTruncated"):
            break
        key_marker, version_marker = page.get("NextKeyMarker"), page.get("NextVersionIdMarker")
    # 현재 버전이 버저닝 없는 버킷이면 위 목록이 비어 있을 수 있어 단순 삭제도 한 번 더 시도한다(멱등).
    client.delete_object(Bucket=bucket, Key=object_key)
    uploads = client.list_multipart_uploads(Bucket=bucket, Prefix=object_key)
    for upload in uploads.get("Uploads", []):
        if upload["Key"] == object_key:
            client.abort_multipart_upload(Bucket=bucket, Key=object_key, UploadId=upload["UploadId"])
    return True


def delete_export(object_key: str) -> None:
    try:
        _export_client().delete_object(Bucket=settings.s3_bucket, Key=object_key)
    except Exception as exc:
        raise ExportStorageError('delete_failed') from exc
