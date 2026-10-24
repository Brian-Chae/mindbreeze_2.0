"""SDD-243 반출 전용 재인증(B05 경계, 구현은 B07).

proof 는 actor·role·scope_org·목적·request_hash 또는 job_id·auth_epoch·만료에 바인딩돼야 한다.
검증기가 연결되기 전에는 **항상 거절**한다(fail closed) — UI 체크박스나 빈 proof 로는 생성되지 않는다.
"""
from typing import Protocol

from sqlalchemy.orm import Session as DBSession

from app.services.data_center_policy import ResolvedContext, deny


class ProofVerifier(Protocol):
    def verify(self, db: DBSession, context: ResolvedContext, proof: str, *, request_hash: str, purpose: str) -> bool: ...


_verifier: ProofVerifier | None = None


def set_verifier(verifier: ProofVerifier | None) -> None:
    global _verifier
    _verifier = verifier


def verify_export_proof(db: DBSession, context: ResolvedContext, proof: str | None, *, request_hash: str,
                        purpose: str) -> None:
    if not proof:
        raise deny(403, 'reauth_required', '반출 전 재인증이 필요합니다')
    if _verifier is None:
        raise deny(403, 'reauth_unavailable', '재인증 검증기가 연결되지 않았습니다')
    if not _verifier.verify(db, context, proof, request_hash=request_hash, purpose=purpose):
        raise deny(403, 'reauth_invalid', '재인증이 만료되었거나 유효하지 않습니다')
