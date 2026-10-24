"""SDD-243 반출 전용 재인증(B07).

proof = actor·role·scope_org·목적(aud=data_export)·바인딩(request_hash 또는 job_id)·auth_epoch·만료에 묶인 서명 토큰.
- 생성 시에는 preview 의 request_hash, URL 발급 시에는 job_id 에 바인딩되어 서로 바꿔 쓸 수 없다.
- 계정 탈퇴용 proof(SDD-220, aud 다름)는 거부된다. 기관 전환·소속 해제·역할/비밀번호 변경은 auth_epoch 가 달라져 무효화된다.
- 검증기가 없거나(None) proof 가 없으면 거절(fail closed). 비밀번호·proof 는 로그/감사에 남기지 않는다.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import UUID

from jose import JWTError, jwt
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.core.security import verify_password
from app.models.user import User
from app.schemas.data_export import ExportProof, ExportReauthRequest
from app.services.client_overview_service import admin_org_ids
from app.services.data_center_policy import ResolvedContext, deny

AUDIENCE = 'data_export'
ISSUER = 'mb-data-center'
SOCIAL_PROVIDERS = ('google', 'apple')


class ProofVerifier(Protocol):
    def verify(self, db: DBSession, context: ResolvedContext, proof: str, *, request_hash: str | None = None,
               job_id: UUID | None = None, purpose: str = '') -> bool: ...


def auth_epoch(db: DBSession, context: ResolvedContext) -> str:
    """인증 문맥 지문: 역할·상태·비밀번호·활성 관리 기관·선택 기관이 바뀌면 달라진다."""
    user = db.query(User).populate_existing().filter(User.id == context.actor_id).first()
    if user is None:
        return ''
    orgs = sorted(str(o) for o in admin_org_ids(db, user.id)) if user.role == 'org_admin' else []
    raw = '|'.join([user.role, user.status, user.password_hash[-16:], ','.join(orgs), str(context.scope_org_id)])
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _binding(request_hash: str | None, job_id: UUID | None) -> str:
    if bool(request_hash) == bool(job_id):
        raise deny(422, 'binding_invalid', 'request_hash 또는 job_id 중 하나만 지정해 주세요')
    return f'rh:{request_hash}' if request_hash else f'job:{job_id}'


def check_reauth_method(db: DBSession, context: ResolvedContext, body: ExportReauthRequest) -> User:
    """계정 유형과 요청 방식이 맞는지 확인한다: 이메일=비밀번호, 소셜(구글·애플)=소셜 재로그인 proof."""
    _binding(body.request_hash, body.job_id)
    user = db.query(User).populate_existing().filter(User.id == context.actor_id).first()
    if user is None or user.status != 'active':
        raise deny(403, 'actor_forbidden', '활성 계정만 재인증할 수 있습니다')
    if user.auth_provider == 'email':
        if not body.credential:
            raise deny(403, 'reauth_method_unsupported', '이메일 계정은 로그인 비밀번호로 확인해 주세요')
    elif user.auth_provider in SOCIAL_PROVIDERS:
        if not body.social_proof:
            raise deny(403, 'reauth_method_unsupported', '소셜 계정은 해당 서비스로 다시 로그인해 본인을 확인해 주세요')
    else:
        raise deny(403, 'reauth_method_unsupported', '이 계정 유형의 재인증은 지원하지 않습니다')
    return user


def issue_export_proof(db: DBSession, context: ResolvedContext, body: ExportReauthRequest, *,
                       social_verified: bool = False) -> ExportProof:
    """5분(설정값) 증명을 발급한다. 이메일은 비밀번호를 확인하고, 소셜은 호출자가 소비·검증한
    SDD-220 1회용 proof(purpose=data_export)를 받은 경우에만 발급한다(social_verified)."""
    binding = _binding(body.request_hash, body.job_id)
    user = check_reauth_method(db, context, body)
    if user.auth_provider == 'email':
        if not verify_password(body.credential or '', user.password_hash):
            raise deny(403, 'reauth_invalid', '재인증이 실패했습니다')
    elif not social_verified:
        raise deny(403, 'reauth_invalid', '재인증이 실패했습니다')
    now = datetime.now(timezone.utc)
    ttl = context.policy.reauth_ttl_seconds
    claims = {'iss': ISSUER, 'aud': AUDIENCE, 'sub': str(user.id), 'role': context.role, 'org': str(context.scope_org_id),
              'bind': binding, 'ae': auth_epoch(db, context), 'iat': int(now.timestamp()),
              'exp': int((now + timedelta(seconds=ttl)).timestamp()), 'jti': secrets.token_hex(8)}
    return ExportProof(proof=jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm),
                       expires_at=now + timedelta(seconds=ttl))


class SignedProofVerifier:
    def verify(self, db: DBSession, context: ResolvedContext, proof: str, *, request_hash: str | None = None,
               job_id: UUID | None = None, purpose: str = '') -> bool:
        try:
            claims = jwt.decode(proof, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm], audience=AUDIENCE,
                                issuer=ISSUER)
        except JWTError:
            return False
        ttl = context.policy.reauth_ttl_seconds
        if int(datetime.now(timezone.utc).timestamp()) - int(claims.get('iat', 0)) >= ttl:  # 정책이 축소돼도 적용
            return False
        want = _binding(request_hash, job_id)
        return (claims.get('sub') == str(context.actor_id) and claims.get('role') == context.role
                and claims.get('org') == str(context.scope_org_id) and claims.get('bind') == want
                and claims.get('ae') == auth_epoch(db, context))


_verifier: ProofVerifier | None = SignedProofVerifier()


def set_verifier(verifier: ProofVerifier | None) -> None:
    global _verifier
    _verifier = verifier


def verify_export_proof(db: DBSession, context: ResolvedContext, proof: str | None, *, request_hash: str | None = None,
                        job_id: UUID | None = None, purpose: str = '') -> None:
    if not proof:
        raise deny(403, 'reauth_required', '반출 전 재인증이 필요합니다')
    if _verifier is None:
        raise deny(403, 'reauth_unavailable', '재인증 검증기가 연결되지 않았습니다')
    if not _verifier.verify(db, context, proof, request_hash=request_hash, job_id=job_id, purpose=purpose):
        raise deny(403, 'reauth_invalid', '재인증이 만료되었거나 유효하지 않습니다')
