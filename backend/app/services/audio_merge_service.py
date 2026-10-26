"""SDD-247: 오디오 청크 형식 판별 및 STT/재생용 병합 서비스.

- 형식은 파일 바이트 매직으로 판별한다(DB 컬럼 없음).
  mp4(m4a/aac): 오프셋 4에 `ftyp` / webm: `1A 45 DF A3`(EBML).
- 기존 웹 경로(MediaRecorder)는 첫 청크만 EBML 헤더를 가진 연속 webm 이므로 바이트 이어붙이기로 병합한다.
- 네이티브(iOS·Android) m4a 는 청크마다 독립 파일이므로 ffmpeg concat 으로 단일 m4a 를 만든다.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

FORMAT_MP4 = "mp4"
FORMAT_WEBM = "webm"
FORMAT_UNKNOWN = "unknown"

_EBML_MAGIC = b"\x1a\x45\xdf\xa3"

# 형식별 저장 확장자 / mime
EXTENSIONS = {FORMAT_MP4: ".m4a", FORMAT_WEBM: ".webm", FORMAT_UNKNOWN: ".bin"}
MIME_WEBM = "audio/webm"
MIME_MP4 = "audio/mp4"

FFMPEG_TIMEOUT_SECONDS = 300


def sniff_format(head: bytes) -> str:
    """선두 바이트로 오디오 컨테이너 형식을 판별한다(mp4|webm|unknown)."""
    if len(head) >= 8 and head[4:8] == b"ftyp":
        return FORMAT_MP4
    if head[:4] == _EBML_MAGIC:
        return FORMAT_WEBM
    return FORMAT_UNKNOWN


def sniff_file_format(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return sniff_format(f.read(16))
    except OSError:
        return FORMAT_UNKNOWN


def _ffmpeg_bin() -> str | None:
    return shutil.which("ffmpeg")


def ffmpeg_available() -> bool:
    return _ffmpeg_bin() is not None


def _needs_transcode(formats: list[str]) -> bool:
    """바이트 병합이 불가능한 조합인지 판정한다.

    - mp4 가 하나라도 있으면(독립 청크) ffmpeg 필요.
    - webm 이 둘 이상 EBML 헤더를 가지면(독립 청크 혼재) ffmpeg 필요.
      (연속 webm: 첫 청크만 헤더, 나머지는 unknown(헤더 없는 클러스터)로 판별됨)
    """
    if FORMAT_MP4 in formats:
        return True
    return formats.count(FORMAT_WEBM) > 1


def _byte_merge(paths: list[str], out_path: str) -> None:
    with open(out_path, "wb") as out:
        for p in paths:
            with open(p, "rb") as src:
                shutil.copyfileobj(src, out)


def _ffmpeg_concat(paths: list[str], out_path: str, all_mp4: bool = False) -> None:
    ffmpeg = _ffmpeg_bin()
    if not ffmpeg:
        raise RuntimeError("ffmpeg 가 설치되어 있지 않아 m4a/혼재 청크를 병합할 수 없습니다")
    if all_mp4:
        _concat_demuxer(ffmpeg, paths, out_path)
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return
    _concat_filter(ffmpeg, paths, out_path)


def _concat_demuxer(ffmpeg: str, paths: list[str], out_path: str) -> None:
    """동일 코덱 m4a 전용. 혼재 형식에서는 성공 코드로 잘못된 길이를 만들 수 있어 쓰지 않는다."""
    list_file = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
    try:
        with list_file:
            for p in paths:
                escaped = os.path.abspath(p).replace("'", "'\\''")
                list_file.write(f"file '{escaped}'\n")
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
               "-i", list_file.name, "-vn", "-c:a", "aac", "-b:a", "64k", out_path]
        res = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS)
        if res.returncode == 0:
            return
        logger.warning("[audio_merge] concat demuxer 실패 — filter_complex 폴백: %s",
                       res.stderr.decode("utf-8", "ignore")[-300:])
    finally:
        try:
            os.unlink(list_file.name)
        except OSError:
            pass


def _concat_filter(ffmpeg: str, paths: list[str], out_path: str) -> None:
    # 입력을 모두 디코드해 concat 필터로 이어붙임(webm+m4a 혼재 등)
    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    for p in paths:
        cmd += ["-i", p]
    n = len(paths)
    filt = "".join(f"[{i}:a]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    cmd += ["-filter_complex", filt, "-map", "[a]", "-c:a", "aac", "-b:a", "64k", out_path]
    res = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS)
    if res.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError(f"ffmpeg 병합 실패: {res.stderr.decode('utf-8', 'ignore')[-300:]}")


def split_existing(chunk_paths: list[str]) -> tuple[list[str], list[str]]:
    """존재/누락 분리(STT-01)."""
    existing: list[str] = []
    missing: list[str] = []
    for p in chunk_paths:
        (existing if os.path.exists(p) else missing).append(p)
    return existing, missing


def merge_chunks_for_stt(chunk_paths: list[str]) -> tuple[str, str]:
    """청크들을 단일 파일로 병합해 (경로, mime)을 반환한다. 호출자가 파일을 삭제한다.

    누락 청크는 건너뛰고 경고한다(STT-01). 존재 청크가 없으면 RuntimeError.
    """
    existing, missing = split_existing(chunk_paths)
    if not existing:
        raise RuntimeError("전사 가능한 청크 없음 — 전부 누락")
    if missing:
        logger.warning("[audio_merge] [청크 누락] %d개 건너뜀: %s", len(missing), missing)

    formats = [sniff_file_format(p) for p in existing]
    if not _needs_transcode(formats):
        fd = tempfile.NamedTemporaryFile(suffix=EXTENSIONS[FORMAT_WEBM], delete=False)
        fd.close()
        try:
            _byte_merge(existing, fd.name)
        except Exception:
            _safe_unlink(fd.name)
            raise
        return fd.name, MIME_WEBM

    fd = tempfile.NamedTemporaryFile(suffix=EXTENSIONS[FORMAT_MP4], delete=False)
    fd.close()
    try:
        _ffmpeg_concat(existing, fd.name, all_mp4=all(f == FORMAT_MP4 for f in formats))
    except Exception:
        _safe_unlink(fd.name)
        raise
    return fd.name, MIME_MP4


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
