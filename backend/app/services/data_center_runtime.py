"""SDD-243 ↔ SDD-244 런타임 연결(통합 지점).

243 은 `MeasurementBackend` / `set_raw_artifact_source` 계약으로만 244 를 소비한다. 이 모듈이 그 계약의 실제 구현이다.

- `BiosignalMeasurementBackend`: 244 manifest(T06) + raw 청크(T03 디코더)로 파형/PSD/반출 대상 판정을 공급한다.
- `RawExportSource`: 244 T12 `SDD243ArtifactSource` 를 job 마다 만들어 쓰는 프록시. 정책 재검사(동의)는 파일마다 한다.
- `install()`: 앱 시작(main)과 Celery 워커(export_task) 양쪽에서 호출한다. 멱등이다.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
from contextlib import contextmanager
from typing import Callable
from uuid import UUID

from fastapi import HTTPException

from app.services import data_center_export as dcx
from app.services import data_center_measurement as dm

logger = logging.getLogger(__name__)

_STREAM_PATH = re.compile(r'/stream-S(\d+)/segment-(\d+)/')
FULL_RANGE = ('-9223372036854775808', '9223372036854775807')


def _storage_reader(key: str, version_id: str | None) -> bytes | None:
    from app.services import storage_service
    return storage_service.download_bytes(key)


def _unavailable(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={'code': code, 'message': '측정 데이터를 읽을 수 없습니다'})


class BiosignalMeasurementBackend:
    """DB 원장(244 manifest revision + eeg_raw_chunks) 기반 MeasurementBackend. 호출마다 자기 DB 세션을 연다."""

    def __init__(self, session_factory: Callable | None = None, reader: Callable[[str, str | None], bytes | None] | None = None):
        self._session_factory = session_factory
        self._reader = reader or _storage_reader

    def _sessions(self):
        if self._session_factory is not None:
            return self._session_factory
        from app.core.database import SessionLocal
        return SessionLocal

    def get_manifest(self, session_id: UUID, participant_id: UUID, revision: int | None = None) -> dm.ManifestView | None:
        from app.models.record import EEGRawChunk
        from app.services import biosignal_manifest_service as manifests
        with self._sessions()() as db:
            try:
                manifest = manifests.get_manifest(session_id, participant_id, revision, db)
                db.commit()  # revision=None 은 판정을 갱신할 수 있다(새 immutable revision)
            except HTTPException as exc:
                db.rollback()
                if exc.status_code == 404:
                    return None  # 수신 자료가 없는 참여자
                raise
            aliases = [a.artifact_id_alias for a in manifest.artifacts if a.artifact_kind == 'raw' and a.availability == 'available']
            rows = {}
            if aliases:
                rows = {r.chunk_alias: r for r in db.query(EEGRawChunk).filter(
                    EEGRawChunk.session_id == session_id, EEGRawChunk.participant_id == participant_id,
                    EEGRawChunk.chunk_alias.in_(aliases)).all()}
            return self._view(manifest, rows, session_id, participant_id)

    @staticmethod
    def _view(manifest, rows, session_id: UUID, participant_id: UUID) -> dm.ManifestView:
        from app.schemas.biosignal import RawChunkMeta, RawHeader
        from app.services.biosignal_decoder import sample_relative_us
        streams = tuple(dm.StreamInfo(
            stream_id=s.stream_alias, segment_id=s.segment_alias, signal=s.signal,
            rate_hz=s.rate.numerator / s.rate.denominator,
            observed_rate_hz=(s.observed_rate.numerator / s.observed_rate.denominator) if s.observed_rate else None,
            channels=tuple(s.channels), units=tuple(s.units), time_basis=s.time_basis) for s in manifest.streams)
        by_signal = {s.signal: s for s in manifest.streams}
        chunks: list[dm.ChunkRef] = []
        for ref in manifest.artifacts:
            row = rows.get(ref.artifact_id_alias)
            if ref.artifact_kind != 'raw' or ref.availability != 'available' or row is None:
                continue
            if row.schema_version != 'mb-biosignal-raw-v2' or not row.header:
                continue  # 확인되지 않은 v1 은 시간축을 추정하지 않는다
            header = RawHeader.model_validate(row.header)
            meta = RawChunkMeta(session_id=session_id, participant_id=participant_id, play_group_id=row.play_group_id,
                                chunk_id=row.id, header=header, checksum=row.checksum, size_bytes=row.size_bytes,
                                object_key=row.object_key, object_version_id=row.object_version_id)
            match = _STREAM_PATH.search(ref.path)
            if match:
                stream_id, segment_id = f'Stream{int(match.group(1)):02d}', f'Segment{int(match.group(2)):02d}'
            else:
                fallback = by_signal.get(row.signal_type)
                stream_id, segment_id = (fallback.stream_alias, fallback.segment_alias) if fallback else ('Stream01', 'Segment01')
            # manifest time_range 는 ms 반올림이라 마지막 샘플을 자를 수 있다 — 헤더 앵커로 정확한 유리수 시간에서 계산한다.
            start_us = math.floor(sample_relative_us(header.anchor, header.rate, header.first_sample_index))
            end_us = math.ceil(sample_relative_us(header.anchor, header.rate, header.end_sample_index_exclusive))
            chunks.append(dm.ChunkRef(
                signal=row.signal_type, stream_id=stream_id, segment_id=segment_id, chunk_index=header.chunk_index,
                first_sample_index=header.first_sample_index, end_sample_index_exclusive=header.end_sample_index_exclusive,
                start_us=start_us, end_us=end_us, meta=meta))
        return dm.ManifestView(
            revision=manifest.revision, close_state=manifest.close_state, default_view=manifest.default_view,
            signals={c.signal: (c.availability, c.unavailable_reason) for c in manifest.signals},
            streams=streams, chunks=tuple(chunks),
            gaps=tuple(dm.GapRange(start_us=g.start_us, end_us=g.end_us, reason=g.reason,
                                   observed_or_estimated=g.observed_or_estimated) for g in manifest.gaps))

    def fetch(self, chunk: dm.ChunkRef) -> bytes:
        meta = chunk.meta
        payload = self._reader(meta.object_key, meta.object_version_id)
        if payload is None:
            raise _unavailable(503, 'chunk_unavailable')
        if len(payload) != meta.size_bytes or hashlib.sha256(payload).hexdigest() != meta.checksum:
            raise _unavailable(502, 'chunk_integrity_failed')
        return payload

    def decode(self, payload: bytes, chunk: dm.ChunkRef):
        from app.services.biosignal_decoder import DecodeError, decode_raw_chunk
        try:
            return decode_raw_chunk(payload, chunk.meta)
        except DecodeError as exc:
            logger.warning('data_center_decode_failed chunk=%s err=%s', chunk.chunk_index, type(exc).__name__)
            raise _unavailable(502, 'chunk_decode_failed') from exc


class RawExportSource:
    """243 `set_raw_artifact_source` 에 등록되는 어댑터. job 단위 컨텍스트(요청 범위·동의)를 묶어 244 T12 에 위임한다."""

    def __init__(self, session_factory: Callable | None = None, reader: Callable[[str, str | None], bytes | None] | None = None):
        self._session_factory = session_factory
        self._reader = reader or _storage_reader

    def _sessions(self):
        if self._session_factory is not None:
            return self._session_factory
        from app.core.database import SessionLocal
        return SessionLocal

    @contextmanager
    def _db(self):
        db = self._sessions()()
        try:
            yield db
        finally:
            db.close()

    def _request(self, target) -> dict:
        from app.models.data_export import DataExportJob, DataExportPreview
        with self._db() as db:
            job = db.get(DataExportJob, target.job_id) if getattr(target, 'job_id', None) else None
            preview = db.get(DataExportPreview, job.preview_id) if job is not None and job.preview_id else None
            return dict(preview.request or {}) if preview is not None else {}

    def _selection(self, target, signals, policy):
        from app.schemas.biosignal import ExportSelection
        request = self._request(target)
        return ExportSelection(
            signals=sorted(signals),
            time_range={'from_us': str(request.get('from_us') or FULL_RANGE[0]), 'to_us': str(request.get('to_us') or FULL_RANGE[1])},
            sample_format=policy.eeg_format if policy.eeg_format in ('csv', 'parquet') else 'csv', view_kind='participant_player')

    def _consent_check(self, target, policy):
        """파일마다 현재 동의를 다시 본다(작업 도중 철회 반영). 정확히 True 일 때만 허용."""
        from app.models.research import ResearchConsent
        from app.models.session import SessionParticipant

        def check(manifest, reference, export_policy) -> bool:
            with self._db() as db:
                participant = db.get(SessionParticipant, target.participant_id)
                if participant is None or participant.consent_eeg is not True:
                    return False
                if policy.purpose == 'research':
                    consent = db.query(ResearchConsent).filter(ResearchConsent.participant_id == target.participant_id).first()
                    return consent is not None and consent.consented is True and consent.withdrawn_at is None
                return True
        return check

    def _source(self, target, policy):
        from app.services.biosignal_export_adapter import SDD243ArtifactSource
        return SDD243ArtifactSource(
            db_provider=self._db, reader=self._reader, policy_check=self._consent_check(target, policy),
            selection_provider=self._selection)

    def artifacts(self, scope, target, policy, signals):
        yield from self._source(target, policy).artifacts(scope, target, policy, signals)

    def indices_artifact(self, db, target, scope, policy):
        return self._source(target, policy).indices_artifact(db, target, scope, policy)

    def indices_sidecars(self, db, target, scope, policy):
        return self._source(target, policy).indices_sidecars(db, target, scope, policy)


def install() -> None:
    """실제 어댑터를 243 에 등록한다. 앱 프로세스와 Celery 워커가 각자 호출한다(멱등)."""
    if not isinstance(dm._registered, BiosignalMeasurementBackend):
        dm.register_backend(BiosignalMeasurementBackend())
    if not isinstance(dcx.RAW_ARTIFACT_SOURCE, RawExportSource):
        dcx.set_raw_artifact_source(RawExportSource())
