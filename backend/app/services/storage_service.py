"""SDD-027 T3 — S3 프리사인드 URL 발급 헬퍼.

raw EEG 청크는 서버를 거치지 않고 클라이언트가 S3 로 직접 PUT 한다(아키텍처 규칙: S3 프리사인드).
자격증명이 없는 로컬/테스트 환경에서는 결정적 스텁 URL 을 반환해 흐름을 검증 가능하게 한다
(실제 업로드는 배포 환경 자격증명이 있을 때 동작한다).
"""

import logging
from datetime import datetime, timezone

from app.config import settings

logger = logging.getLogger(__name__)

# TLS 필수(데이터 프라이버시 규칙) — 스텁 URL 도 https 로 구성한다.
_STUB_HOST = f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com"


def _stub_url(object_key: str) -> str:
    return f"{_STUB_HOST}/{object_key}?stub=1"


def generate_presigned_put(
    object_key: str,
    *,
    content_type: str = "application/octet-stream",
    expires_in: int = 3600,
) -> str:
    """S3 PUT 프리사인드 URL 을 발급한다.

    자격증명 미설정/오류 시 스텁 URL 로 폴백한다(예외를 전파하지 않는다).
    """
    if not (settings.aws_access_key_id and settings.aws_secret_access_key):
        # 자격증명 미설정 — 로컬/테스트. 실제 서명 없이 스텁 URL 반환.
        return _stub_url(object_key)
    try:
        import boto3

        client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        return client.generate_presigned_url(
            "put_object",
            Params={"Bucket": settings.s3_bucket, "Key": object_key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[storage] presigned 발급 실패, 스텁 URL 폴백: %s", exc)
        return _stub_url(object_key)


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


def generate_presigned_get(object_key: str, *, expires_in: int = 300, expires_at: datetime | None = None) -> str:
    if not 1 <= expires_in <= 300:
        raise ExportStorageError('invalid_expiry')
    try:
        client = _export_client()
        client.head_object(Bucket=settings.s3_bucket, Key=object_key)
        if expires_at is not None:
            expires_in = min(expires_in, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
            if expires_in < 1:
                raise ExportStorageError('package_expired')
        return client.generate_presigned_url('get_object', Params={
            'Bucket': settings.s3_bucket, 'Key': object_key,
            'ResponseContentType': 'application/zip',
            'ResponseContentDisposition': 'attachment; filename="mindbreeze-data.zip"',
        }, ExpiresIn=expires_in)
    except Exception as exc:
        raise ExportStorageError('presign_failed') from exc


def delete_export(object_key: str) -> None:
    try:
        _export_client().delete_object(Bucket=settings.s3_bucket, Key=object_key)
    except Exception as exc:
        raise ExportStorageError('delete_failed') from exc
