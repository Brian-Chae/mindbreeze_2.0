"""SDD-260 QA — loadtest_ingest_v3_40.py 단위 검증용 모의 서버 (contract.md 를 메모리로 구현). 실서버 아님.

ASGI 앱을 httpx.ASGITransport 로 직접 붙인다(포트·DB 불필요). S3 PUT 은 /_s3/{chunk_id} 로 흉내 낸다.
"""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

from fastapi import Body, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse


class MockState:
    def __init__(self) -> None:
        self.features: dict[tuple[str, str, str, int], str] = {}          # (sid,pid,stream,seq) -> hash
        self.chunks: dict[str, dict[str, Any]] = {}                        # chunk_id -> row
        self.by_alias: dict[tuple[str, str, str], str] = {}                 # (sid,pid,alias) -> chunk_id
        self.blobs: dict[str, bytes] = {}
        self.batch_calls = 0
        self.max_windows_seen = 0
        self.presign_429_left = 0
        self.fail_batch_5xx_left = 0
        self.streams_by_pid: dict[str, set[str]] = {}
        self.creds: dict[str, str] = {}                                    # credential -> pid


def build_app(state: MockState) -> FastAPI:
    app = FastAPI()
    B = "/api/v1/sessions/{sid}"

    def pid_of(cred: str | None) -> str | None:
        return state.creds.get(cred or "")

    @app.post(B + "/features/batch")
    def batch(sid: str, payload: dict = Body(...), x_entry_credential: str | None = Header(None)):
        pid = pid_of(x_entry_credential)
        if pid is None:
            return JSONResponse({"detail": "unauth"}, 401)
        ws = payload.get("windows") or []
        if not (1 <= len(ws) <= 300):
            return JSONResponse({"detail": {"code": "invalid_message", "field": "windows"}}, 422)
        if state.fail_batch_5xx_left > 0:
            state.fail_batch_5xx_left -= 1
            return JSONResponse({"detail": "boom"}, 503)
        state.batch_calls += 1
        state.max_windows_seen = max(state.max_windows_seen, len(ws))
        results = []
        for w in ws:
            key = (sid, pid, w["stream_id"], int(w["sequence"]))
            r = {"stream_id": w["stream_id"], "sequence": w["sequence"]}
            if w["participant_id"] != pid or w["session_id"] != sid:
                r.update(status="rejected", code="participant_mismatch", durable=False)
            elif w["stream_id"] not in state.streams_by_pid.get(pid, set()):
                r.update(status="rejected", code="stream_not_owned", durable=False)
            elif key in state.features:
                if state.features[key] == w["feature_hash"]:
                    r.update(status="duplicate", durable=True)
                else:
                    r.update(status="rejected", code="hash_conflict", durable=False)
            else:
                state.features[key] = w["feature_hash"]
                r.update(status="accepted", durable=True)
            results.append(r)
        counts = {k: sum(1 for r in results if r["status"] == k) for k in ("accepted", "duplicate", "rejected")}
        return {"session_id": sid, "participant_id": pid, "results": results, "counts": counts}

    @app.get(B + "/features/summary")
    def fsummary(sid: str, participant_id: str | None = Query(None), x_entry_credential: str | None = Header(None)):
        pid = pid_of(x_entry_credential)
        if pid is None:
            return JSONResponse({"detail": "unauth"}, 401)
        per: dict[str, list[int]] = {}
        for (s, p, st, seq) in state.features:
            if s == sid and p == pid:
                per.setdefault(st, []).append(seq)
        streams = []
        for st, seqs in per.items():
            seqs.sort()
            miss, cont = [], -1
            for a, b in zip(seqs, seqs[1:]):
                if b - a > 1:
                    miss.append([a + 1, b - 1])
            if seqs[0] == 0:
                cont = 0
                for q in seqs[1:]:
                    if q == cont + 1:
                        cont = q
                    else:
                        break
            streams.append({"stream_id": st, "count": len(seqs), "min_index": seqs[0], "max_index": seqs[-1], "contiguous_through": cont,
                            "missing_ranges": miss, "truncated": False})
        return {"session_id": sid, "participant_id": pid, "total_count": sum(len(v) for v in per.values()), "streams": streams, "updated_at": None}

    @app.post(B + "/biosignal-raw/presign")
    def presign(sid: str, request: Request, payload: dict = Body(...), x_entry_credential: str | None = Header(None)):
        pid = pid_of(x_entry_credential)
        if pid is None:
            return JSONResponse({"detail": "unauth"}, 401)
        if state.presign_429_left > 0:
            state.presign_429_left -= 1
            return JSONResponse({"detail": {"code": "archive_busy"}}, 429, headers={"Retry-After": "2"})
        items = []
        for c in payload["chunks"]:
            h = c["header"]
            alias = c["chunk_alias"]
            cid = state.by_alias.get((sid, pid, alias))
            if cid is None:
                cid = str(uuid.uuid4())
                state.by_alias[(sid, pid, alias)] = cid
                state.chunks[cid] = {"sid": sid, "pid": pid, "alias": alias, "stream_id": h["stream_id"], "segment_id": h["segment_id"],
                                     "signal": h["signal_type"], "index": h["chunk_index"], "checksum": c["checksum"], "size": c["size_bytes"], "status": "pending"}
            row = state.chunks[cid]
            up = None if row["status"] == "uploaded" else f"http://s3.mock/_s3/{cid}"
            items.append({"chunk_id": cid, "chunk_alias": alias, "signal_type": h["signal_type"], "stream_id": h["stream_id"], "segment_id": h["segment_id"],
                          "chunk_index": h["chunk_index"], "object_key": f"k/{cid}", "checksum": c["checksum"], "size_bytes": c["size_bytes"],
                          "upload_url": up, "upload_headers": {"x-amz-checksum-sha256": "x"}, "upload_status": row["status"], "expires_in_sec": 900})
        return {"session_id": sid, "participant_id": pid, "chunks": items}

    @app.put("/_s3/{cid}")
    async def s3put(cid: str, request: Request):
        state.blobs[cid] = await request.body()
        return JSONResponse({}, 200)

    @app.post(B + "/biosignal-raw/ack")
    def ack(sid: str, payload: dict = Body(...), x_entry_credential: str | None = Header(None)):
        pid = pid_of(x_entry_credential)
        if pid is None:
            return JSONResponse({"detail": "unauth"}, 401)
        out, acked, failed = [], 0, 0
        for it in payload["chunks"]:
            row = state.chunks.get(it["chunk_id"])
            blob = state.blobs.get(it["chunk_id"])
            if row and blob is not None and hashlib.sha256(blob).hexdigest() == it["checksum"] and len(blob) == it["size_bytes"]:
                row["status"] = "uploaded"
                acked += 1
                out.append({"chunk_id": it["chunk_id"], "chunk_alias": row["alias"], "upload_status": "uploaded", "checksum": it["checksum"],
                            "size_bytes": it["size_bytes"], "verified_at_us": "1", "failure_reason": None})
            elif row and row["status"] == "uploaded":
                acked += 1
                out.append({"chunk_id": it["chunk_id"], "chunk_alias": row["alias"], "upload_status": "uploaded", "checksum": it["checksum"],
                            "size_bytes": it["size_bytes"], "verified_at_us": "1", "failure_reason": None})
            else:
                failed += 1
                out.append({"chunk_id": it["chunk_id"], "chunk_alias": (row or {}).get("alias", "x"), "upload_status": "pending",
                            "checksum": it["checksum"], "size_bytes": it["size_bytes"], "verified_at_us": None, "failure_reason": "object_missing"})
        return {"session_id": sid, "acked": acked, "failed": failed, "chunks": out}

    @app.get(B + "/biosignal-raw/summary")
    def rsummary(sid: str, participant_id: str | None = Query(None), x_entry_credential: str | None = Header(None)):
        pid = pid_of(x_entry_credential)
        if pid is None:
            return JSONResponse({"detail": "unauth"}, 401)
        rows = [r for r in state.chunks.values() if r["sid"] == sid and r["pid"] == pid]
        up = [r for r in rows if r["status"] == "uploaded"]
        receipt = sorted((r["stream_id"], r["segment_id"], r["signal"], int(r["index"]), r["checksum"], int(r["size"])) for r in up)
        digest = hashlib.sha256("|".join("|".join(str(x) for x in t) for t in receipt).encode()).hexdigest()
        return {"session_id": sid, "participant_id": pid, "total": len(rows), "uploaded": len(up), "pending": len(rows) - len(up), "failed": 0,
                "streams": [], "aliases_uploaded": sorted(r["alias"] for r in up), "aliases_truncated": False, "receipt_hash": digest, "updated_at": None}

    return app
