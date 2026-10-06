"""SDD-027 T3 — S3 프리사인드 URL 발급 헬퍼.

raw EEG 청크는 서버를 거치지 않고 클라이언트가 S3 로 직접 PUT 한다(아키텍처 규칙: S3 프리사인드).
자격증명이 없는 로컬/테스트 환경에서는 결정적 스텁 URL 을 반환해 흐름을 검증 가능하게 한다
(실제 업로드는 배포 환경 자격증명이 있을 때 동작한다).
"""

import logging
from datetime import datetime, timezone
from functools import lru_cache

from app.config import settings

logger = logging.getLogger(__name__)

# TLS 필수(데이터 프라이버시 규칙) — 스텁 URL 도 https 로 구성한다.
_STUB_HOST = f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com"


class StorageSigningError(RuntimeError):
    """자격증명이 설정된 배포 환경에서 presigned 서명이 실패했을 때 발생한다.

    스텁 URL 로 조용히 폴백하면 클라이언트가 실제로는 PUT 불가한 가짜 URL 을 받아
    업로드가 유실되므로, 자격증명이 있는 환경에서는 실패를 숨기지 않고 전파한다.
    """


def _stub_url(object_key: str) -> str:
    return f"{_STUB_HOST}/{object_key}?stub=1"


def storage_configured() -> bool:
    """S3 자격증명이 설정되어 실제 서명/조회가 가능한지 여부.

    미설정(로컬/테스트) 환경은 스텁으로 흐름만 검증하며, 검증·서명 실패를
    실제 오류로 취급하지 않는다.
    """
    return bool(settings.aws_access_key_id and settings.aws_secret_access_key)


def generate_presigned_put(
    object_key: str,
    *,
    content_type: str = "application/octet-stream",
    expires_in: int = 3600,
) -> str:
    """S3 PUT 프리사인드 URL 을 발급한다.

    - 자격증명 미설정(로컬/테스트): 실제 서명이 불가하므로 결정적 스텁 URL 을 반환한다(현행 유지).
    - 자격증명 설정(배포): 서명 실패를 스텁으로 숨기지 않고 StorageSigningError 로 전파한다.
    """
    if not storage_configured():
        # 자격증명 미설정 — 로컬/테스트. 실제 서명 없이 스텁 URL 반환.
        return _stub_url(object_key)
    try:
        import boto3

        # boto3 가 region_name 만으로는 virtual-hosted presigned URL 을 us-east-1(s3.amazonaws.com)로
        # 잘못 생성해 307 리다이렉트가 나는 문제(SDD-027 후속)가 있어, 리전 endpoint 를 명시해 고정한다.
        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=f"https://s3.{settings.s3_region}.amazonaws.com",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        return client.generate_presigned_url(
            "put_object",
            Params={"Bucket": settings.s3_bucket, "Key": object_key, "ContentType": content_type},
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


@lru_cache(maxsize=1)
def _s3_client():
    """S3 클라이언트(프로세스당 1회 생성·재사용).

    boto3 client는 스레드 안전하므로 병렬 다운로드/업로드에서 공유해도 안전하다.
    자격증명 미설정 시 None 을 반환한다(호출부가 로컬 폴백 결정).
    """
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
        return None
    try:
        import boto3

        return boto3.client(
            "s3",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] S3 클라이언트 생성 실패: %s", exc)
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
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
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
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
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
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
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
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
        raise ExportStorageError('storage_not_configured')
    try:
        import boto3
        from botocore.config import Config
        return boto3.client(
            's3', region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
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


def delete_export(object_key: str) -> None:
    try:
        _export_client().delete_object(Bucket=settings.s3_bucket, Key=object_key)
    except Exception as exc:
        raise ExportStorageError('delete_failed') from exc
