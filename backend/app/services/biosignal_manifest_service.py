"""SDD-244 T06 — gap 이벤트 / close intent 수신과 회차·참여자 manifest revision.

- gap·close intent 는 id 기준 멱등(같은 내용 duplicate, 다른 내용 conflict).
- close intent 의 expected set·수신 순번·gap 순번을 서버 원장(ACK 상태)과 대조해 close_state 를 판정한다.
  complete 는 기대 항목 전부가 검증 ACK 된 경우뿐이고, 후발 ACK 는 새 immutable revision 을 만든다.
- 공개 ManifestRevision 은 alias 만 노출한다(내부 UUID/object key 불포함). 정책(동의·철회·만료) 재검사는
  반출 시점(SDD-243/C)의 책임이며 policy_recheck_required=True 로 표시한다.
"""
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.biosignal import (
    BiosignalArtifact, BiosignalCloseIntent, BiosignalGapEvent, BiosignalManifestCurrent,
    BiosignalManifestRevision, DisplaySnapshot, NormalizationSnapshotRow,
)
from app.models.record import EEGRawChunk
from app.schemas.biosignal import (
    AlgorithmSnapshot, ArtifactReference, CloseIntent, CloseIntentIn, EventsRequest, ExportStream, GapEvent,
    GapEventIn, ManifestRevision, NormalizationSnapshot, ParserProfile, Rate, RawHeader, SignalCoverage,
    StreamCloseSequence, TimeRange, ViewCloseSequence,
)
from app.services import biosignal_service, eeg_raw_service, session_service, storage_service

logger = logging.getLogger(__name__)

SIGNALS = ("eeg", "ppg", "acc")
UNKNOWN_SHA = "0" * 64


def _canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(obj) -> str:
    return hashlib.sha256(_canon(obj).encode()).hexdigest()


def _alias(prefix: str, value: str) -> str:
    """내부 ID 를 되돌릴 수 없는 공개 alias 로(서버 비밀키 HMAC). 키가 비면 sha256 으로 대체."""
    key = (settings.jwt_secret_key or "").encode()
    digest = hmac.new(key, f"{prefix}:{value}".encode(), hashlib.sha256).hexdigest()
    return f"{prefix}{digest[:12].upper()}"


# ── 이벤트 수신 ────────────────────────────────────────────────────────────


def record_events(session_id: str, payload: EventsRequest, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = biosignal_service.resolve_participant(
        sid, payload.participant_id, db, current_user_id=current_user_id, entry_credential=entry_credential)
    results: list[dict] = []
    changed = False
    saw_intent = False
    for ev in payload.events:
        dumped = ev.model_dump(mode="json")
        digest = _hash(dumped)
        if isinstance(ev, GapEventIn):
            status, detail = _record_gap(sid, participant.id, ev, digest, db)
            results.append({"event_type": "gap", "event_id": str(ev.event_id), "status": status, "detail": detail})
        else:
            saw_intent = True
            status, detail = _record_intent(sid, participant.id, ev, dumped, digest, db)
            results.append({"event_type": "close_intent", "event_id": str(ev.intent_id), "status": status, "detail": detail})
        changed = changed or status == "recorded"
    revision = state = None
    missing: list[dict] = []
    if changed or saw_intent:
        evaluation = refresh(db, sid, participant.id)
        if evaluation is not None:
            revision, state, missing = evaluation.revision, evaluation.state, evaluation.missing_dicts()
    db.commit()
    return {
        "session_id": str(sid), "participant_id": str(participant.id), "events": results,
        "manifest_revision": revision, "close_state": state, "missing_artifacts": missing,
    }


def _record_gap(sid, pid, ev: GapEventIn, digest: str, db: DBSession) -> tuple[str, str | None]:
    existing = db.query(BiosignalGapEvent).filter_by(session_id=sid, participant_id=pid, event_id=str(ev.event_id)).first()
    if existing is not None:
        return ("duplicate", None) if existing.payload_hash == digest else ("conflict", "same_event_id_different_content")
    clash = db.query(BiosignalGapEvent).filter_by(session_id=sid, participant_id=pid, sequence=ev.sequence).first()
    if clash is not None:
        return "conflict", "sequence_already_used"
    try:
        with db.begin_nested():
            db.add(BiosignalGapEvent(
                session_id=sid, participant_id=pid, event_id=str(ev.event_id), sequence=ev.sequence, signal=ev.signal,
                stream_id=str(ev.stream_id), segment_id=str(ev.segment_id), start_us=int(ev.start_us),
                end_us=int(ev.end_us) if ev.end_us is not None else None, discovered_at_us=int(ev.discovered_at_us),
                reason=ev.reason, observed_or_estimated=ev.observed_or_estimated, expected_samples=ev.expected_samples,
                received_samples=ev.received_samples, reconnect_count=ev.reconnect_count, payload_hash=digest))
            db.flush()
    except IntegrityError:
        again = db.query(BiosignalGapEvent).filter_by(session_id=sid, participant_id=pid, event_id=str(ev.event_id)).first()
        if again is not None and again.payload_hash == digest:
            return "duplicate", None
        return "conflict", "concurrent_write"
    return "recorded", None


def _record_intent(sid, pid, ev: CloseIntentIn, dumped: dict, digest: str, db: DBSession) -> tuple[str, str | None]:
    existing = db.query(BiosignalCloseIntent).filter_by(session_id=sid, participant_id=pid, intent_id=str(ev.intent_id)).first()
    if existing is not None:
        return ("duplicate", None) if existing.payload_hash == digest else ("conflict", "same_intent_id_different_content")
    try:
        with db.begin_nested():
            db.add(BiosignalCloseIntent(session_id=sid, participant_id=pid, intent_id=str(ev.intent_id), payload=dumped, payload_hash=digest))
            db.flush()
    except IntegrityError:
        again = db.query(BiosignalCloseIntent).filter_by(session_id=sid, participant_id=pid, intent_id=str(ev.intent_id)).first()
        if again is not None and again.payload_hash == digest:
            return "duplicate", None
        return "conflict", "concurrent_write"
    return "recorded", None


# ── 판정과 manifest 조립 ───────────────────────────────────────────────────


@dataclass
class Evaluation:
    state: str
    manifest: ManifestRevision | None = None
    revision: int | None = None
    missing: list[tuple[str, str, str]] = field(default_factory=list)  # (kind, alias, sha)

    def missing_dicts(self) -> list[dict]:
        return [{"kind": k, "alias": a, "sha256": s} for k, a, s in self.missing]


def _latest_intent(db: DBSession, sid, pid) -> BiosignalCloseIntent | None:
    rows = db.query(BiosignalCloseIntent).filter_by(session_id=sid, participant_id=pid).all()
    if not rows:
        return None
    return max(rows, key=lambda r: (int(r.payload.get("closed_at_us", "0")), r.created_at or 0, str(r.id)))


def _covered(ranges: list[tuple[int, int]], last: int) -> list[tuple[int, int]]:
    """0..last 중 ranges 로 덮이지 않은 구간(포함 범위)."""
    gaps, cursor = [], 0
    for lo, hi in sorted(ranges):
        if lo > cursor:
            gaps.append((cursor, min(lo - 1, last)))
        cursor = max(cursor, hi + 1)
        if cursor > last:
            return [g for g in gaps if g[0] <= g[1]]
    if cursor <= last:
        gaps.append((cursor, last))
    return gaps


def evaluate(db: DBSession, sid, pid) -> Evaluation:
    raws = db.query(EEGRawChunk).filter(
        EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == pid,
        EEGRawChunk.schema_version == biosignal_service.RAW_V2_SCHEMA).all()
    arts = db.query(BiosignalArtifact).filter_by(session_id=sid, participant_id=pid).all()
    all_gaps = db.query(BiosignalGapEvent).filter_by(session_id=sid, participant_id=pid).order_by(BiosignalGapEvent.sequence).all()
    intent_row = _latest_intent(db, sid, pid)
    intent = CloseIntentIn.model_validate(intent_row.payload) if intent_row else None
    lost = {(x["kind"], x["alias"]): x["reason"] for x in (intent_row.payload.get("lost_artifacts", []) if intent_row else [])}

    raw_by_alias = {r.chunk_alias: r for r in raws if r.chunk_alias}
    art_by_alias = {a.artifact_alias: a for a in arts}
    gaps = [g for g in all_gaps if intent is not None and intent.last_gap_sequence is not None and g.sequence <= intent.last_gap_sequence]

    missing: list[tuple[str, str, str]] = []
    expected: dict[tuple[str, str], str] = {}
    if intent is not None:
        for e in intent.expected_artifacts:
            key = (e.kind, e.alias)
            expected[key] = e.sha256
            if key in lost:
                continue
            row = raw_by_alias.get(e.alias) if e.kind == "raw" else art_by_alias.get(e.alias)
            if row is None or row.upload_status != "uploaded" or row.checksum != e.sha256 or (e.kind != "raw" and row.artifact_kind != e.kind):
                missing.append((e.kind, e.alias, e.sha256))
        known = set(expected)
        extras = [("raw", r.chunk_alias) for r in raws if r.chunk_alias and ("raw", r.chunk_alias) not in known]
        extras += [(a.artifact_kind, a.artifact_alias) for a in arts if (a.artifact_kind, a.artifact_alias) not in known]
        for kind, alias in extras:
            if (kind, alias) not in lost:
                missing.append((kind, alias, UNKNOWN_SHA))
        # 수신 순번 구멍: raw
        for s in intent.streams:
            if s.last_chunk_sequence is not None:
                present = {r.chunk_index for r in raws if (r.stream_id, r.segment_id, r.signal_type) == (str(s.stream_id), str(s.segment_id), s.signal)}
                for i in range(s.last_chunk_sequence + 1):
                    if i not in present and ("raw", f"RAWMISSING-{s.signal}-{i}") not in lost:
                        missing.append(("raw", f"RAWMISSING-{s.signal}-{i}", UNKNOWN_SHA))
            if s.last_feature_sequence is not None:
                ranges = [(a.first_sequence if a.first_sequence is not None else a.sequence,
                           a.last_sequence if a.last_sequence is not None else a.sequence)
                          for a in arts if a.artifact_kind == "feature" and a.upload_status == "uploaded"
                          and (a.stream_id, a.segment_id, a.signal) == (str(s.stream_id), str(s.segment_id), s.signal)]
                for lo, hi in _covered(ranges, s.last_feature_sequence):
                    missing.append(("feature", f"FEATMISSING-{s.signal}-{lo}-{hi}", UNKNOWN_SHA))
        for v in intent.snapshots:
            if v.last_snapshot_sequence is not None:
                ranges = [(a.first_sequence if a.first_sequence is not None else a.sequence,
                           a.last_sequence if a.last_sequence is not None else a.sequence)
                          for a in arts if a.artifact_kind == "indices" and a.upload_status == "uploaded"
                          and (a.stream_id, a.view_instance_id) == (str(v.stream_id), str(v.view_instance_id))]
                for lo, hi in _covered(ranges, v.last_snapshot_sequence):
                    missing.append(("indices", f"IDXMISSING-{lo}-{hi}", UNKNOWN_SHA))
        # gap 순번 연속성 + 의도 이후 gap
        if intent.last_gap_sequence is not None:
            have = {g.sequence for g in gaps}
            for i in range(intent.last_gap_sequence + 1):
                if i not in have:
                    missing.append(("gap", f"GAPMISSING-{i}", UNKNOWN_SHA))
        elif all_gaps:
            missing.append(("gap", "GAPUNEXPECTED", UNKNOWN_SHA))
        # indices 가 참조한 feature alias 해석
        from app.services.biosignal_artifact_service import resolve_feature_alias
        refs: set[str] = set()
        for snap in db.query(DisplaySnapshot).filter_by(session_id=sid, participant_id=pid).all():
            refs.update(snap.source_feature_aliases or [])
        for alias in sorted(refs):
            if resolve_feature_alias(db, sid, pid, alias) is None:
                missing.append(("feature", alias, UNKNOWN_SHA))

    # 중복 제거(순서 유지)
    seen, uniq = set(), []
    for item in missing:
        if item[:2] not in seen:
            seen.add(item[:2])
            uniq.append(item)
    missing = uniq

    if intent is None:
        state = "unknown"
    elif missing:
        state = "pending_upload"
    elif lost:
        state = "partial"
    else:
        state = "complete"

    manifest = _assemble(db, sid, pid, raws, arts, gaps if intent else all_gaps, intent, intent_row, lost, state)
    return Evaluation(state=state, manifest=manifest, missing=missing)


def _assemble(db, sid, pid, raws, arts, gaps, intent, intent_row, lost, state) -> ManifestRevision:
    # stream/segment alias: 첫 청크 생성 순서로 안정적으로 번호를 매긴다(새 stream 은 뒤에 붙는다)
    ordered = sorted(raws, key=lambda r: (r.created_at is None, r.created_at, str(r.id)))
    stream_no: dict[str, int] = {}
    seg_no: dict[tuple[str, str], int] = {}
    for r in ordered:
        stream_no.setdefault(r.stream_id, len(stream_no) + 1)
        seg_no.setdefault((r.stream_id, r.segment_id), sum(1 for k in seg_no if k[0] == r.stream_id) + 1)

    def s_alias(stream_id: str) -> str:
        n = stream_no.setdefault(stream_id, len(stream_no) + 1)
        return f"Stream{n:02d}"

    def g_alias(stream_id: str, segment_id: str) -> str:
        s_alias(stream_id)
        n = seg_no.setdefault((stream_id, segment_id), sum(1 for k in seg_no if k[0] == stream_id) + 1)
        return f"Segment{n:02d}"

    streams: list[ExportStream] = []
    seen_scope: set[tuple[str, str, str]] = set()
    for r in ordered:
        scope = (r.stream_id, r.segment_id, r.signal_type)
        if scope in seen_scope or not r.header:
            continue
        seen_scope.add(scope)
        h = RawHeader.model_validate(r.header)
        streams.append(ExportStream(
            stream_alias=s_alias(r.stream_id), segment_alias=g_alias(r.stream_id, r.segment_id), signal=r.signal_type,
            profile=h.parser_profile, rate=h.rate, observed_rate=h.observed_rate,
            observed_rate_window_us=h.observed_rate_window_us, observed_rate_reason=h.observed_rate_reason,
            channels=h.channels, units=h.units, time_basis=h.time_basis))

    artifacts: list[ArtifactReference] = []
    uploaded_raw = [r for r in raws if r.upload_status == "uploaded"]
    sig_samples = {s: sum(r.sample_count or 0 for r in uploaded_raw if r.signal_type == s) for s in SIGNALS}
    expected_aliases = {(e.kind, e.alias) for e in intent.expected_artifacts} if intent else set()

    def ref(kind, alias, path, schema, row_count, size, sha, usha, trange, retention, signal, status, reason=None) -> ArtifactReference:
        lost_flag = (kind, alias) in lost
        available = status == "uploaded" and not lost_flag
        return ArtifactReference(
            artifact_id_alias=alias, artifact_kind=kind, path=path, schema_version=schema, dictionary_key=kind,
            row_count=row_count, size_bytes=size, sha256=sha, uncompressed_sha256=usha, time_range=trange,
            selection=None, extra_range=[], retention=retention, retention_deadline_us=None,
            consent_scope=[signal or "session"], consent_version="unspecified",
            availability="available" if available else ("lost" if lost_flag else "unknown"),
            unavailable_reason=None if available else (lost.get((kind, alias)) or reason or "upload_not_verified"),
            ack_state="verified" if available else ("unavailable" if lost_flag else ("failed" if status == "failed" else "pending")))

    for r in sorted(raws, key=lambda x: (x.signal_type, x.stream_id, x.segment_id, x.chunk_index)):
        if not r.chunk_alias or (intent and ("raw", r.chunk_alias) not in expected_aliases):
            continue
        trange = None
        if r.start_ms is not None and r.end_ms is not None:
            trange = TimeRange(from_us=str(int(r.start_ms * 1000)), to_us=str(int(r.end_ms * 1000)))
        artifacts.append(ref(
            "raw", r.chunk_alias,
            f"raw/{r.signal_type}/stream-S{stream_no[r.stream_id]:02d}/segment-{seg_no[(r.stream_id, r.segment_id)]:03d}/chunk-{r.chunk_index:06d}.bin",
            r.schema_version, r.sample_count, r.size_bytes, r.checksum, None, trange, "raw_90_days", r.signal_type, r.upload_status))
    for a in sorted(arts, key=lambda x: (x.artifact_kind, x.artifact_alias)):
        if intent and (a.artifact_kind, a.artifact_alias) not in expected_aliases:
            continue
        trange = TimeRange(from_us=str(a.time_from_us), to_us=str(a.time_to_us)) if a.time_from_us is not None and a.time_to_us is not None else None
        artifacts.append(ref(
            a.artifact_kind, a.artifact_alias, f"{a.artifact_kind}/{a.artifact_alias}.bin", a.schema_version, a.row_count,
            a.size_bytes, a.checksum, a.uncompressed_sha256, trange, a.retention_class, a.signal, a.upload_status))

    public_gaps = [
        GapEvent(
            discovered_at_us=str(g.discovered_at_us), event_id_alias=f"Gap{g.sequence + 1:02d}", signal=g.signal,
            stream_alias=s_alias(g.stream_id), segment_alias=g_alias(g.stream_id, g.segment_id), start_us=str(g.start_us),
            end_us=str(g.end_us) if g.end_us is not None else None, reason=g.reason,
            observed_or_estimated=g.observed_or_estimated, expected_samples=g.expected_samples,
            received_samples=g.received_samples, reconnect_count=g.reconnect_count, sequence=g.sequence)
        for g in gaps
    ]
    # gap 은 서버가 정규 JSONL(순번순)로 합성하는 단일 산출물로 expected set 에 포함된다
    close_expected: dict[str, str] = {e.alias: e.sha256 for e in intent.expected_artifacts} if intent else {}
    if intent and public_gaps:
        gap_sha = _hash([g.model_dump(mode="json") for g in public_gaps])
        artifacts.append(ArtifactReference(
            artifact_id_alias="GAPS", artifact_kind="gap", path="gap/GAPS.jsonl", schema_version="gap-v1", dictionary_key="gap",
            row_count=len(public_gaps), size_bytes=len(_canon([g.model_dump(mode="json") for g in public_gaps])),
            sha256=gap_sha, uncompressed_sha256=None, time_range=None, selection=None, extra_range=[],
            retention="feature_policy", retention_deadline_us=None, consent_scope=["session"], consent_version="unspecified",
            availability="available", unavailable_reason=None, ack_state="committed"))
        close_expected["GAPS"] = gap_sha

    coverage = []
    for sig in SIGNALS:
        sig_gaps = [g for g in gaps if g.signal == sig]
        registered = any(r.signal_type == sig for r in raws)
        declared = sum(s.received_samples for s in intent.streams if s.signal == sig) if intent else None
        unknown = any(g.expected_samples is None or g.received_samples is None for g in sig_gaps)
        lost_known = None if unknown else sum(max(0, g.expected_samples - g.received_samples) for g in sig_gaps)
        any_lost = any(r.signal_type == sig and ("raw", r.chunk_alias) in lost for r in raws)
        if sig_samples[sig] > 0:
            avail, reason = "available", None
        elif any_lost:
            avail, reason = "lost", "declared_lost"
        elif registered:
            avail, reason = "unknown", "upload_not_verified"
        else:
            avail, reason = "not_collected", "no_data_received"
        coverage.append(SignalCoverage(
            signal=sig, availability=avail, unavailable_reason=reason, expected_samples=declared,
            acked_samples=sig_samples[sig], lost_samples=lost_known, unknown_samples=unknown))

    snaps = db.query(DisplaySnapshot).filter_by(session_id=sid, participant_id=pid).all()
    kinds = {s.view_kind for s in snaps}
    default_view = "participant_player" if "participant_player" in kinds else ("session_player" if "session_player" in kinds else "unavailable")
    hashes = sorted({s.normalization_hash for s in snaps if s.normalization_hash})
    models = []
    if hashes:
        for row in db.query(NormalizationSnapshotRow).filter(NormalizationSnapshotRow.params_hash.in_(hashes)).all():
            models.append(NormalizationSnapshot.model_validate(row.content))
    algorithms = _algorithms(arts)

    bases = {s.time_basis for s in streams}
    time_basis = "host_estimated" if "host_estimated" in bases else ("utc_verified" if bases == {"utc_verified"} else "session_relative")

    public_intent = None
    if intent is not None:
        public_intent = CloseIntent(
            intent_id_alias=_alias("Intent", str(intent.intent_id)), expected_artifacts=close_expected,
            streams=[StreamCloseSequence(
                stream_alias=s_alias(str(s.stream_id)), segment_alias=g_alias(str(s.stream_id), str(s.segment_id)),
                signal=s.signal, last_chunk_sequence=s.last_chunk_sequence, last_feature_sequence=s.last_feature_sequence,
                received_samples=s.received_samples) for s in intent.streams],
            snapshots=[ViewCloseSequence(
                stream_alias=s_alias(str(v.stream_id)), view_instance_alias=_alias("View", str(v.view_instance_id)),
                last_snapshot_sequence=v.last_snapshot_sequence) for v in intent.snapshots],
            last_gap_sequence=intent.last_gap_sequence, end_reason=intent.end_reason)

    return ManifestRevision(
        schema_version="manifest-v1", revision=1, session_alias=_alias("S", str(sid)),
        participant_alias=_alias("P", str(pid)), close_state=state, close_intent=public_intent, time_basis=time_basis,
        default_view=default_view, streams=streams, signals=coverage, artifacts=artifacts, gaps=public_gaps,
        models=models, algorithms=algorithms, policy_recheck_required=True, raw_packet_policy="blocked_requires_redaction")


def _algorithms(arts) -> list[AlgorithmSnapshot]:
    out: list[AlgorithmSnapshot] = []
    for a in arts:
        if a.artifact_kind != "algorithm" or a.upload_status != "uploaded":
            continue
        try:
            raw = storage_service.download_bytes(a.object_key)
            if raw is None:
                continue
            from app.services.biosignal_artifact_service import _decode, _lines
            for line in _lines(_decode(raw, a.content_encoding)):
                out.append(AlgorithmSnapshot.model_validate(line))
        except Exception:  # noqa: BLE001 — 해석 불가 알고리즘 snapshot 은 목록에서 제외하고 artifact 로만 남긴다
            logger.warning("[biosignal] algorithm snapshot 해석 실패 artifact=%s", a.artifact_alias)
    return out


# ── revision 저장 ──────────────────────────────────────────────────────────


def refresh(db: DBSession, sid, pid) -> Evaluation | None:
    """원장 상태로 manifest 를 다시 판정하고, 내용이 달라졌을 때만 새 immutable revision 을 만든다.

    close intent 가 없고 수신 자료도 없으면 None. (자료만 있으면 close_state=unknown revision.)
    """
    has_data = db.query(EEGRawChunk.id).filter(
        EEGRawChunk.session_id == sid, EEGRawChunk.participant_id == pid,
        EEGRawChunk.schema_version == biosignal_service.RAW_V2_SCHEMA).first() is not None
    has_data = has_data or db.query(BiosignalArtifact.id).filter_by(session_id=sid, participant_id=pid).first() is not None
    has_data = has_data or db.query(BiosignalGapEvent.id).filter_by(session_id=sid, participant_id=pid).first() is not None
    if not has_data:
        return None
    ev = evaluate(db, sid, pid)
    for _ in range(3):
        latest = (
            db.query(BiosignalManifestRevision).filter_by(session_id=sid, participant_id=pid)
            .order_by(BiosignalManifestRevision.revision.desc()).first()
        )
        body = ev.manifest.model_dump(mode="json")
        body["revision"] = 1
        digest = _hash(body)
        if latest is not None and latest.content_sha256 == digest:
            ev.revision = latest.revision
            ev.manifest = ManifestRevision.model_validate(latest.content)
            return ev
        number = (latest.revision if latest else 0) + 1
        body["revision"] = number
        try:
            with db.begin_nested():
                db.add(BiosignalManifestRevision(
                    session_id=sid, participant_id=pid, revision=number, close_state=ev.state,
                    close_intent_id=ev.manifest.close_intent.intent_id_alias if ev.manifest.close_intent else None,
                    content=body, content_sha256=digest))
                db.flush()
        except IntegrityError:
            continue
        pointer = db.get(BiosignalManifestCurrent, (sid, pid))
        if pointer is None:
            db.add(BiosignalManifestCurrent(session_id=sid, participant_id=pid, revision=number))
        elif pointer.revision < number:
            pointer.revision = number
        db.flush()
        ev.revision = number
        ev.manifest = ManifestRevision.model_validate(body)
        return ev
    raise HTTPException(status_code=409, detail="manifest revision 경합 — 다시 시도하세요")


def refresh_if_closing(db: DBSession, sid, pid) -> None:
    """ACK 직후 호출: close intent 가 있으면 후발 ACK 로 바뀐 판정을 새 revision 으로 남긴다."""
    if db.query(BiosignalCloseIntent.id).filter_by(session_id=sid, participant_id=pid).first() is not None:
        refresh(db, sid, pid)


# ── 조회 ───────────────────────────────────────────────────────────────────


def get_manifest(session_id: UUID, participant_id: UUID, revision: int | None, db: DBSession) -> ManifestRevision:
    """SDD-243 소비용: 지정 revision(없으면 최신)의 공개 manifest. 인가는 호출자 책임, 정책은 반출 시 재검사."""
    if revision is None:
        refresh(db, session_id, participant_id)
        pointer = db.get(BiosignalManifestCurrent, (session_id, participant_id))
        revision = pointer.revision if pointer else None
    row = None
    if revision is not None:
        row = db.query(BiosignalManifestRevision).filter_by(
            session_id=session_id, participant_id=participant_id, revision=revision).first()
    if row is None:
        raise HTTPException(status_code=404, detail="manifest revision 을 찾을 수 없습니다")
    return ManifestRevision.model_validate(row.content)


def manifest_response(session_id: str, participant_id: UUID | None, revision: int | None, db: DBSession, *, current_user_id=None, entry_credential=None) -> dict:
    sid, _ = eeg_raw_service._get_session(session_id, db)
    participant = session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=str(participant_id) if participant_id else None)
    if revision is None:
        refresh(db, sid, participant.id)
        db.commit()
    pointer = db.get(BiosignalManifestCurrent, (sid, participant.id))
    latest = pointer.revision if pointer else None
    manifest = None
    target = revision or latest
    if target is not None:
        row = db.query(BiosignalManifestRevision).filter_by(session_id=sid, participant_id=participant.id, revision=target).first()
        if row is None:
            raise HTTPException(status_code=404, detail="manifest revision 을 찾을 수 없습니다")
        manifest = row.content
    return {"session_id": str(sid), "participant_id": str(participant.id), "latest_revision": latest, "manifest": manifest}
