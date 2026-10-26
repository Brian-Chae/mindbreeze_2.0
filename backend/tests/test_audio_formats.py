"""SDD-247 BE: 오디오 청크 형식 판별·병합·STT 연동 (verify B1~B7)."""

import shutil
import subprocess

import pytest

from tests.test_audio_record import _create_session, _register

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg/ffprobe 없음")

MP4_HEAD = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00" + b"x" * 40
WEBM_HEAD = b"\x1a\x45\xdf\xa3" + b"x" * 40


@pytest.fixture(autouse=True)
def _chunk_dir(tmp_path, monkeypatch):
    from app.services import audio_service

    monkeypatch.setattr(audio_service, "CHUNK_STORAGE_DIR", tmp_path / "chunks")


def _start(client):
    host = _register(client, "fmt@test.com")
    sid = _create_session(client, host)
    r = client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    assert r.status_code == 200, r.text
    return host, sid


def _upload(client, host, sid, idx, data):
    return client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": str(idx)},
        files={"file": (f"chunk-{idx}", data, "application/octet-stream")},
        headers=host["auth"],
    )


def _path_of(sid, idx):
    from app.core.database import SessionLocal
    from app.models.record import AudioChunk

    db = SessionLocal()
    try:
        return db.query(AudioChunk).filter(AudioChunk.chunk_index == idx).order_by(AudioChunk.id.desc()).first().file_path
    finally:
        db.close()


def test_b1_mp4_저장은_m4a_확장자(client):
    host, sid = _start(client)
    r = _upload(client, host, sid, 0, MP4_HEAD)
    assert r.status_code == 200, r.text
    assert r.json()["received_bytes"] == len(MP4_HEAD)
    assert _path_of(sid, 0).endswith(".m4a")


def test_b2_webm_webm_임의는_bin_거부안함(client):
    host, sid = _start(client)
    assert _upload(client, host, sid, 0, WEBM_HEAD).status_code == 200
    assert _upload(client, host, sid, 1, b"random-bytes-no-header").status_code == 200
    assert _path_of(sid, 0).endswith(".webm")
    assert _path_of(sid, 1).endswith(".bin")


def test_b3_동일_인덱스_멱등(client):
    host, sid = _start(client)
    _upload(client, host, sid, 0, MP4_HEAD)
    r = _upload(client, host, sid, 0, MP4_HEAD + b"more")
    assert r.status_code == 200
    assert r.json()["received_bytes"] == len(MP4_HEAD)
    assert r.json()["total_chunks"] == 1


def test_b3_processing_상태에서도_수용(client):
    host, sid = _start(client)
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert _upload(client, host, sid, 0, MP4_HEAD).status_code == 200


def test_b4_연속_webm_바이트_병합(tmp_path):
    from app.services import audio_merge_service as m

    a, b, c = tmp_path / "a", tmp_path / "b", tmp_path / "c"
    a.write_bytes(WEBM_HEAD)
    b.write_bytes(b"cluster-1")
    c.write_bytes(b"cluster-2")
    path, mime = m.merge_chunks_for_stt([str(a), str(b), str(c)])
    try:
        assert mime == "audio/webm"
        assert open(path, "rb").read() == WEBM_HEAD + b"cluster-1" + b"cluster-2"
    finally:
        import os
        os.unlink(path)


def _make_audio(path, fmt, seconds=1.0):
    codec = ["-c:a", "aac"] if fmt == "m4a" else ["-c:a", "libopus"]
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-ar", "48000" if fmt == "webm" else "44100", "-ac", "1", *codec, str(path)],
        check=True,
    )


def _duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


@needs_ffmpeg
def test_b5_m4a_3청크_concat(tmp_path):
    import os
    from app.services import audio_merge_service as m

    files = []
    for i in range(3):
        p = tmp_path / f"{i}.m4a"
        _make_audio(p, "m4a")
        files.append(str(p))
    path, mime = m.merge_chunks_for_stt(files)
    try:
        assert mime == "audio/mp4"
        assert m.sniff_file_format(path) == "mp4"
        assert 2.8 <= _duration(path) <= 3.3
    finally:
        os.unlink(path)


@needs_ffmpeg
def test_b6_혼재_및_누락_건너뜀(tmp_path):
    import os
    from app.services import audio_merge_service as m

    a, b = tmp_path / "a.webm", tmp_path / "b.m4a"
    _make_audio(a, "webm")
    _make_audio(b, "m4a")
    path, mime = m.merge_chunks_for_stt([str(a), str(tmp_path / "missing.m4a"), str(b)])
    try:
        assert mime == "audio/mp4"
        assert 1.8 <= _duration(path) <= 2.3
    finally:
        os.unlink(path)


def test_b6_전부_누락이면_오류(tmp_path):
    from app.services import audio_merge_service as m

    with pytest.raises(RuntimeError):
        m.merge_chunks_for_stt([str(tmp_path / "nope")])


def test_b7_stt_gemini_whisper_가_병합_mime_사용(tmp_path, monkeypatch):
    import httpx
    import requests
    from app.config import settings
    from app.tasks import stt_task

    m4a = tmp_path / "c0.m4a"
    m4a.write_bytes(MP4_HEAD)
    merged = tmp_path / "merged.m4a"
    merged.write_bytes(b"merged")

    def fake_merge(paths):
        return str(merged), "audio/mp4"

    from app.services import audio_merge_service
    monkeypatch.setattr(audio_merge_service, "merge_chunks_for_stt", fake_merge)

    captured = {}

    class _G:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": '[{"speaker":"speaker_0","text":"a","start":0,"end":1}]'}]}}]}

    def fake_gemini(url, headers=None, json=None, timeout=None):
        captured["mime"] = json["contents"][0]["parts"][1]["inline_data"]["mime_type"]
        return _G()

    monkeypatch.setattr(httpx, "post", fake_gemini)
    stt_task._transcribe_batch([str(m4a)], "meditation")
    assert captured["mime"] == "audio/mp4"

    merged.write_bytes(b"merged")

    class _W:
        def raise_for_status(self):
            pass

        def json(self):
            return {"segments": [], "text": ""}

    def fake_whisper(url, headers=None, files=None, data=None, timeout=None):
        captured["file"] = (files["file"][0], files["file"][2])
        return _W()

    monkeypatch.setattr(settings, "openai_api_key", "k")
    monkeypatch.setattr(requests, "post", fake_whisper)
    stt_task._call_whisper([str(m4a)])
    assert captured["file"] == ("audio.m4a", "audio/mp4")
