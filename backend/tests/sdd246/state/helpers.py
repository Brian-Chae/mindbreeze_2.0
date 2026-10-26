"""T04 시험 보조 — T03 apply_command 로 outbox 를 쌓는 합성 handler."""
from __future__ import annotations

import uuid

from app.services.session_live_commands import Actor, LiveCommand, apply_command, register_handler


def install_hand_handler() -> None:
    """hand.set: speaking(host+member 본인) event 1개 + session public event(옵션)."""

    def handler(ctx):
        raised = bool(ctx.command.payload["raised"])
        ver = int(ctx.command.payload.get("ver", 1))
        pid = str(ctx.actor.participant_id)
        ctx.entity_version = ver
        ctx.emit(domain="speaking", event_type="speaking.changed", entity_id=pid, entity_version=ver,
                 audience=["host", f"member:{pid}"],
                 payload={"participant_id": pid, "hand_raised": raised, "can_publish": False, "grant_version": str(ver)})
        if ctx.command.payload.get("with_session"):
            ctx.emit(domain="session", event_type="session.changed", entity_id=str(ctx.session.id), entity_version=ver,
                     audience=["public", "host"],
                     payload={"phase": "in_progress", "status": ctx.command.payload.get("status", "in_progress"),
                              "started_at_ms": 1760000000000, "ended_at_ms": None, "cutoff_ms": None})

    register_handler("hand.set", handler)


def send(world, i: int, raised: bool = True, ver: int = 1, **extra):
    cmd = LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="hand.set",
                      payload={"raised": raised, "ver": ver, **extra})
    return apply_command(world.maker(), world.member(i), cmd)
