"""개선 10: 명상 가이드·BGM 트랙 스키마 (GET /class/audio-tracks, WS class:audio_sync)."""

from typing import Literal

from pydantic import BaseModel, Field


class AudioToneSpec(BaseModel):
    """내장 톤 소스 — 클라이언트가 Web Audio 로 동일하게 합성한다(자산 불필요)."""

    freq_hz: float = Field(gt=0)
    waveform: Literal["sine", "triangle", "square", "sawtooth"] = "sine"
    gain: float = Field(default=0.12, gt=0, le=1)
    # 미세 디튠(Hz) — 두 주파수를 겹쳐 정적인 소리가 되지 않게 한다(None이면 단일 톤)
    detune_hz: float | None = Field(default=None, gt=0)
    # 맥박 주기(초) — 가이드 트랙의 호흡 안내용 진폭 변조(None이면 변조 없음)
    pulse_sec: float | None = Field(default=None, gt=0)


class AudioTrackResponse(BaseModel):
    """재생 가능한 트랙 1건 — 회원·게스트도 같은 정의를 받아 같은 소스를 재생한다."""

    track_id: str
    title: str
    kind: Literal["bgm", "guide"]
    url: str | None = None
    duration_sec: float | None = None
    synth: AudioToneSpec | None = None
    description: str = ""
    loop: bool = True
    source: Literal["url", "tone"]


class AudioTrackListResponse(BaseModel):
    """트랙 목록 응답."""

    tracks: list[AudioTrackResponse]
    count: int
