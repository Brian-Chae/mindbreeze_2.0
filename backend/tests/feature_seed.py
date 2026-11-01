"""SDD-260 — 구 v1 `POST /sessions/{id}/features` 삭제에 따른 시험 시드 헬퍼.

리포트·롤업·집계 시험은 EEG feature 행을 심는 용도로 구 엔드포인트를 썼다. 저장 로직(`_persist_feature_items`)을 직접 호출해
같은 행을 만든다(정본 REST 경로 시험은 tests/sdd260). 응답 모양(status_code·json()["saved"])은 구 엔드포인트와 같다.
구 엔드포인트의 인증·소유권 동작 시험은 새 `/features/batch` 에 대응하는 시험(tests/sdd260)으로 옮겼다.
"""
from __future__ import annotations

import re
from types import SimpleNamespace
from uuid import UUID


def post_features(client, url: str, json: dict | None = None, headers: dict | None = None, **_ignored):
    from app.core.database import get_db
    from app.models.session import SessionParticipant
    from app.schemas.session import EEGFeatureItem
    from app.services import session_service

    from pydantic import ValidationError

    sid = re.search(r"/sessions/([0-9a-fA-F-]{36})/features", url).group(1)
    body_in = json or {}
    # 인증·소유권 판정은 실제 새 엔드포인트(/features/batch)에 태운다: 빈 windows 로 호출하면 인증 통과 시 422(windows),
    # 실패 시 401/403/404 가 그대로 나온다. 통과하면 시드 저장으로 진행한다.
    probe_body = {"windows": []}
    if body_in.get("participant_id"):
        probe_body["participant_id"] = body_in["participant_id"]
    probe = client.post(f"/api/v1/sessions/{sid}/features/batch", json=probe_body, headers=headers or {})
    if probe.status_code != 422:
        return probe
    gen = client.app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        pid = body_in.get("participant_id")
        if pid is None:  # 본인 행 확정은 서버가 했다 — 시드는 같은 규칙(로그인 → 입장 자격)으로 행을 찾는다
            from app.services.session_service import resolve_participant_actor

            h = headers or {}
            uid = None
            if h.get("Authorization", "").startswith("Bearer "):
                from app.core.security import decode_token
                uid = decode_token(h["Authorization"].split()[1])["sub"]
            pid = resolve_participant_actor(UUID(sid), db, entry_credential=h.get("X-Entry-Credential"),
                                            current_user_id=uid, allow_completed=True).id
        participant = db.get(SessionParticipant, UUID(str(pid)))
        if len(body_in["features"]) > 5000:  # 구 엔드포인트의 max_length 와 동일
            return SimpleNamespace(status_code=422, json=lambda: {"detail": "too many"}, text="too many")
        try:
            items = [EEGFeatureItem(**f) for f in body_in["features"]]
        except ValidationError as exc:  # 구 엔드포인트의 Pydantic 422 와 동일
            return SimpleNamespace(status_code=422, json=lambda: {"detail": str(exc)}, text=str(exc))
        saved = session_service._persist_feature_items(UUID(sid), participant, items, db)
    finally:
        gen.close()
    body = {"session_id": sid, "saved": len(saved)}
    return SimpleNamespace(status_code=200, json=lambda: body, text=str(body),
                           headers={"content-type": "application/json"}, content=b"{}")
