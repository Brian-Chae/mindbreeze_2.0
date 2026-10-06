"""청크 업로드 가드 — 전체 메모리 읽기·무제한 크기 DoS 방지 (STG-01).

기존 API 는 ``await file.read()`` 로 청크 전체를 메모리에 올리고 크기 상한이 없어,
거대한 파일 하나로 서버 메모리를 고갈시킬 수 있었다. 청크를 조각내어 읽으며 상한을
넘으면 즉시 413 으로 거부하고, 빈 파일(0바이트)은 422 로 거부한다.
"""

from fastapi import HTTPException, UploadFile, status

# 한 번에 읽는 조각 크기(1MiB) — 스트리밍으로 메모리 사용을 상한 내로 제한한다.
READ_CHUNK_SIZE = 1024 * 1024

# audio/webm 녹음 청크(프론트가 수 초 단위로 업로드) 기준 넉넉한 상한.
MAX_AUDIO_CHUNK_BYTES = 50 * 1024 * 1024
# video/webm 청크 상한 — 영상은 음성보다 크므로 별도 상한.
MAX_VIDEO_CHUNK_BYTES = 200 * 1024 * 1024


async def read_upload_bounded(file: UploadFile, *, max_bytes: int) -> bytes:
    """UploadFile 을 조각내어 읽고 크기 상한을 강제한다.

    - 상한 초과: 413 을 던진다(전체를 메모리에 올리지 않는다 — 이미 읽은 조각만 버린다).
    - 빈 파일(0바이트): 422 를 던진다.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        piece = await file.read(READ_CHUNK_SIZE)
        if not piece:
            break
        total += len(piece)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"청크 크기가 허용 상한({max_bytes // (1024 * 1024)}MB)을 초과했습니다",
            )
        chunks.append(piece)
    if total == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="빈 청크는 업로드할 수 없습니다",
        )
    return b"".join(chunks)
