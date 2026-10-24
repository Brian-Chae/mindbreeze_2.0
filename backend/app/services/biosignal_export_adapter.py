"""SDD-243 ZIP 소비용, 회차·참여자 revision에 고정된 파일 스트림.

호출자는 인가된 내부 session_id/participant_id, reader(key, version_id),
policy_check(manifest, reference, policy)를 주입한다. check는 현재 동의·철회·만료를
검사하고 정확히 True일 때만 허용한다. 공개 alias를 내부 ID로 역추정하지 않는다.
각 결과의 metadata는 G1 ExportArtifact, iter_bytes()는 ZIP writer용 바이트 iterator다.
객체/파일 하나씩 처리하며 전체 ZIP을 메모리에 쌓지 않는다.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
import gzip
import hashlib
import io
import csv
import json
import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat
from sqlalchemy.orm import Session
from app.models.biosignal import BiosignalArtifact, BiosignalManifestRevision
from app.models.record import EEGRawChunk
from app.models.research_export import ObjectDeletionOutbox
from app.schemas.biosignal import (ExportArtifact, ExportSelection, ExportPolicy, ManifestRevision,
    RawChunkMeta, FeatureRecord, DisplaySnapshot, AlgorithmSnapshot, NormalizationSnapshot)
from app.services.biosignal_decoder import decode_raw_chunk_with_gaps, iter_csv_rows, iter_parquet_rows

Reader = Callable[[str, str | None], bytes | None]
PolicyCheck = Callable[[ManifestRevision, object, ExportPolicy], bool]
METRICS = ('focus','relaxation','emotional','bpm','respiration','hrv')
_UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')


@dataclass(frozen=True)
class ArtifactPayload:
    metadata: ExportArtifact
    payload: bytes

    def iter_bytes(self) -> Iterator[bytes]:
        for start in range(0, len(self.payload), 65536):
            yield self.payload[start:start + 65536]


class RawDerivedRecord(BaseModel):
    """웹 collector의 raw-derived-v1 화이트리스트. 임의 메타 유출 금지."""
    model_config = ConfigDict(extra='forbid')
    feature_id_alias: str = Field(pattern=r'^[A-Z][A-Za-z0-9_-]{0,63}$')
    first_sample_index: int = Field(ge=0)
    fields: dict[str, list[FiniteFloat] | list[list[FiniteFloat]]]


def _json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(',', ':')).encode()


def _redact(value: object, key: str = '', *, exact: bool = False) -> object:
    """계약 객체의 식별자·원시 시계를 기본 가명 반출에서 제거한다."""
    if exact and key in {'computed_at_us','measured_at_us','displayed_at_us','received_at_us','utc_us'}:
        return value
    if key in {'computed_at_us','measured_at_us','displayed_at_us','received_at_us','received_monotonic_us',
               'discovered_at_us','utc_us','tick_raw','tick_unwrapped','device_timestamp_ms','object_key','object_version_id'}:
        return None
    if isinstance(value, dict):
        return {k: _redact(v, k, exact=exact) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v, exact=exact) for v in value]
    if isinstance(value, str):
        return _UUID.sub(lambda m: 'ID-' + hashlib.sha256(m.group().encode()).hexdigest()[:16], value)
    return value


def _file(path, payload, *, kind='algorithm', rows=None, source=None, selection=None, schema='mb-export-v1'):
    base = source.model_dump() if source else dict(artifact_id_alias='EXPORT', artifact_kind=kind,
        dictionary_key='metadata', time_range=None, extra_range=[], retention='metadata_policy',
        retention_deadline_us=None, consent_scope=[], consent_version='policy_rechecked')
    base.update(path=path, artifact_kind=kind, schema_version=schema, row_count=rows,
        size_bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), uncompressed_sha256=None,
        selection=selection, availability='available', unavailable_reason=None, ack_state='committed')
    return ArtifactPayload(ExportArtifact.model_validate(base), payload)


def _table(rows: list[dict], fmt: str) -> bytes:
    if fmt == 'parquet':
        import pyarrow as pa
        import pyarrow.parquet as pq
        table = pa.Table.from_pylist(rows)
        out = io.BytesIO()
        pq.write_table(table, out, compression='zstd')
        return out.getvalue()
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode('utf-8')


def _checked_read(row, ref, reader, db):
    if row.upload_status != 'uploaded' or row.checksum != ref.sha256 or row.size_bytes != ref.size_bytes:
        raise ValueError('pinned_artifact_mismatch')
    if db.query(ObjectDeletionOutbox.id).filter_by(object_key=row.object_key).first():
        raise PermissionError('artifact_deletion_pending')
    payload = reader(row.object_key, row.object_version_id)
    if payload is None or len(payload) != row.size_bytes or hashlib.sha256(payload).hexdigest() != row.checksum:
        raise ValueError('artifact_integrity_failed')
    return payload


def iter_export_artifacts(
    manifest: ManifestRevision, selection: ExportSelection, policy: ExportPolicy, *,
    db: Session, session_id: str | UUID, participant_id: str | UUID,
    reader: Reader, policy_check: PolicyCheck,
) -> Iterator[ArtifactPayload]:
    """원장 revision/hash를 검증하고 파일별 현재 정책을 검사한다. ZIP·인가 UI는 243 소유."""
    sid, pid = UUID(str(session_id)), UUID(str(participant_id))
    pinned = db.query(BiosignalManifestRevision).filter_by(session_id=sid, participant_id=pid, revision=manifest.revision).one_or_none()
    if pinned is None or ManifestRevision.model_validate(pinned.content) != manifest:
        raise ValueError('manifest_revision_mismatch')
    if policy_check(manifest, None, policy) is not True:
        raise PermissionError('export_policy_denied')
    root = f'{manifest.session_alias}/{manifest.participant_alias}'
    missing = []
    lo, hi = int(selection.time_range.from_us), int(selection.time_range.to_us)
    exact = policy.time_policy == 'exact_authorized'
    for ref in manifest.artifacts:
        if ref.artifact_kind not in policy.allowed_artifact_kinds:
            missing.append({'artifact':ref.artifact_id_alias,'reason':'artifact_kind_blocked'})
            continue
        if ref.availability != 'available':
            missing.append({'artifact':ref.artifact_id_alias,'reason':ref.unavailable_reason})
            continue
        if policy_check(manifest, ref, policy) is not True:
            raise PermissionError('export_policy_denied')
        if ref.retention_deadline_us and int(ref.retention_deadline_us) <= int(datetime.now(timezone.utc).timestamp()*1e6):
            missing.append({'artifact':ref.artifact_id_alias,'reason':'expired'})
            continue
        if ref.artifact_kind == 'gap':
            continue  # 고정 revision의 공개 gap만 아래 sidecar에 사용한다.
        model = EEGRawChunk if ref.artifact_kind == 'raw' else BiosignalArtifact
        alias_col = model.chunk_alias if model is EEGRawChunk else model.artifact_alias
        row = db.query(model).filter(model.session_id==sid, model.participant_id==pid, alias_col==ref.artifact_id_alias).one_or_none()
        if row is None:
            missing.append({'artifact':ref.artifact_id_alias,'reason':'expired_or_unavailable'})
            continue
        signal = row.signal_type if model is EEGRawChunk else row.signal
        if signal and signal not in selection.signals:
            continue
        if ref.time_range and (int(ref.time_range.to_us) <= lo or int(ref.time_range.from_us) >= hi):
            continue
        payload = _checked_read(row,ref,reader,db)
        # 파일 경로에 클라이언트가 제공한 alias/UUID를 그대로 사용하지 않는다.
        directory = f'{root}/artifacts/A-{hashlib.sha256(ref.artifact_id_alias.encode()).hexdigest()[:16]}'
        if model is EEGRawChunk:
            if row.schema_version != 'mb-biosignal-raw-v2' or not row.header:
                missing.append({'artifact':ref.artifact_id_alias,'reason':'unsupported_schema'})
                continue
            meta = RawChunkMeta(session_id=sid,participant_id=pid,play_group_id=row.play_group_id,
                chunk_id=row.id,header=row.header,checksum=row.checksum,size_bytes=row.size_bytes,
                object_key=row.object_key,object_version_id=row.object_version_id)
            decoded = decode_raw_chunk_with_gaps(payload,meta)
            samples = [s for s in decoded.samples if s.relative_us is not None and lo <= s.relative_us < hi]
            if not samples:
                continue
            rows = list(iter_csv_rows(samples) if selection.sample_format=='csv' else iter_parquet_rows(samples))
            if exact:
                if any(s.utc_us is None for s in samples):
                    raise ValueError('utc_anchor_unavailable')
                for output, sample in zip(rows,samples):
                    output['timestamp'] = datetime.fromtimestamp(float(sample.utc_us/Fraction(1000000)),timezone.utc).isoformat().replace('+00:00','Z')
            output = _file(f'{directory}/{signal}_raw.{selection.sample_format}',_table(rows,selection.sample_format),
                kind='raw',rows=len(rows),source=ref,selection=selection.time_range,schema=f'{signal}-samples-v1')
            from app.schemas.biosignal import TimeRange
            output.metadata.time_range=TimeRange(from_us=str(round(samples[0].relative_us)),to_us=str(round(samples[-1].relative_us+Fraction(1000000*meta.header.rate.denominator,meta.header.rate.numerator))))
            output.metadata.extra_range=[]
            yield output
            sample_map = [{'sample_index':s.sample_index,'t_rel_us':str(round(s.relative_us)),
                'adc':s.adc,'lead_off':s.lead_off,'packet_seq':s.packet.packet_seq if s.packet else None} for s in samples]
            yield _file(f'{directory}/meta/sample-map.jsonl',b''.join(_json(r)+b'\n' for r in sample_map),kind='sample_map',rows=len(sample_map),source=ref,selection=selection.time_range)
            if policy.raw_packets_authorized and exact and manifest.raw_packet_policy=='lossless_authorized':
                artifact = _file(f'{directory}/raw/{signal}/chunk.bin',payload,kind='raw',source=ref,selection=selection.time_range,schema=row.schema_version)
                extra = []
                if ref.time_range:
                    from app.schemas.biosignal import TimeRange
                    a,b=int(ref.time_range.from_us),int(ref.time_range.to_us)
                    if a<lo: extra.append(TimeRange(from_us=str(a),to_us=str(lo)))
                    if b>hi: extra.append(TimeRange(from_us=str(hi),to_us=str(b)))
                artifact.metadata.extra_range=extra
                yield artifact
            else:
                missing.append({'artifact':ref.artifact_id_alias,'reason':'blocked_requires_redaction','representation':'redacted_sample_map'})
            continue
        if row.content_encoding == 'gzip':
            with gzip.GzipFile(fileobj=io.BytesIO(payload)) as f:
                payload=f.read(8*1024*1024+1)
            if len(payload)>8*1024*1024 or hashlib.sha256(payload).hexdigest()!=row.uncompressed_sha256:
                raise ValueError('uncompressed_integrity_failed')
        types={'feature':FeatureRecord,'indices':DisplaySnapshot,'normalization':NormalizationSnapshot,'algorithm':AlgorithmSnapshot,'raw_derived':RawDerivedRecord}
        if row.artifact_kind not in types:
            missing.append({'artifact':ref.artifact_id_alias,'reason':'unsupported_safe_export'})
            continue
        records=[types[row.artifact_kind].model_validate_json(line).model_dump(mode='json') for line in payload.splitlines() if line]
        if len(records)!=row.row_count: raise ValueError('row_count_mismatch')
        selected=[]
        for r in records:
            if 't_rel_ms' in r and not lo <= r['t_rel_ms']*1000 < hi: continue
            if row.artifact_kind=='indices' and r['view_kind']!=selection.view_kind: continue
            if row.artifact_kind=='feature' and r['signal'] not in selection.signals: continue
            selected.append(_redact(r, exact=exact))
        if not selected: continue
        yield _file(f'{directory}/{row.artifact_kind}.jsonl',b''.join(_json(r)+b'\n' for r in selected),kind=row.artifact_kind,rows=len(selected),source=ref,selection=selection.time_range)
        if row.artifact_kind=='indices':
            yield _file(f'{directory}/meta/display-status.jsonl',b''.join(_json(r)+b'\n' for r in selected),kind='display_status',rows=len(selected),source=ref,selection=selection.time_range)
        flat=[]
        for r in selected:
            if row.artifact_kind=='feature':
                flat.append({k:r[k] for k in ('play_group_id','window_index','t_rel_ms')} | r['scalars'])
            elif row.artifact_kind=='indices':
                n=r['normalization'] or {}
                flat.append({k:r[k] for k in ('t_rel_ms','play_group_id','window_index')} |
                    {k:r[k]['value'] for k in METRICS} | {k+'_display_input':r[k]['display_input'] for k in METRICS} |
                    {'normalization_version':n.get('version'),'normalization_model_id_alias':n.get('model_id_alias'),
                     'normalization_params_hash':n.get('params_hash'),'normalization_source':r['focus']['normalization_source']} |
                    {k:r[k] for k in ('display_pipeline_version','source','display_match','unavailable_reason')})
        if flat:
            name='features' if row.artifact_kind=='feature' else 'indices'
            yield _file(f'{directory}/{name}.{selection.sample_format}',_table(flat,selection.sample_format),kind=row.artifact_kind,rows=len(flat),source=ref,selection=selection.time_range)
    report={'revision':manifest.revision,'policy_revision':policy.policy_revision,'selection':selection.model_dump(mode='json'),
        'signals':[s.model_dump(mode='json') for s in manifest.signals],'unavailable':missing,
        'default_view':selection.view_kind,'raw_packet_policy':manifest.raw_packet_policy}
    yield _file(f'{root}/meta/export.json',_json(_redact(report)))
    gaps=[g.model_dump(mode='json') for g in manifest.gaps if g.signal in selection.signals and int(g.start_us)<hi and (g.end_us is None or int(g.end_us)>lo)]
    if 'gap' in policy.allowed_artifact_kinds:
        yield _file(f'{root}/meta/gaps.jsonl',b''.join(_json(_redact(g))+b'\n' for g in gaps),kind='gap',rows=len(gaps))
    yield _file(f'{root}/README_ko.md',('생체신호 반출 자료\n\n미수집·만료·차단 자료는 파일을 만들지 않으며 meta/export.json에 사유를 기록합니다.\n'
        'CSV 빈칸과 JSON null은 0이 아닙니다. 기본 시각은 회차 상대 초입니다.\n'
        '원문 bin은 별도 무손실·정확시각 권한과 manifest 정책 허용이 모두 필요합니다.\n'
        'HRV는 SDNN(ms)이며 당시 표시 이력 없는 값을 재계산하지 않습니다.\n').encode())
