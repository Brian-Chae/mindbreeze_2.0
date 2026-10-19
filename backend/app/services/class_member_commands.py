"""로그인 멤버 명령의 잠금·멱등·원자 커밋. 도메인 서비스는 flush까지만 수행한다."""
import hashlib
import json
from uuid import UUID
from fastapi import HTTPException
from app.models.class_program import Class, ClassMember
from app.models.class_scheduling import ClassOperation
from app.models.user import User


def execute_member_command(db, actor_id, class_id, command, *, action, target_id, authorize, apply):
    actor_id, class_id = UUID(str(actor_id)), UUID(str(class_id))
    data = command.model_dump(mode="json") if hasattr(command, "model_dump") else dict(command)
    try:
        # 기존 편성과 같은 User→Class 순서. 클래스 잠금 이후 User 잠금은 얻지 않는다.
        actor = db.query(User).filter(User.id == actor_id).populate_existing().with_for_update(key_share=True).first()
        if actor is None or actor.status != "active":
            raise HTTPException(403, detail={"code": "action_forbidden"})
        cls = db.query(Class).filter(Class.id == class_id).populate_existing().with_for_update().first()
        if cls is None:
            raise HTTPException(404, detail={"code": "class_not_found"})
        db.query(ClassMember).filter(ClassMember.class_id == cls.id).order_by(ClassMember.id).populate_existing().with_for_update().all()
        # 재시도에서도 현재 소유권·역할은 반드시 재검사한다.
        authorize(cls, actor, data)
        if actor.role == "org_admin" and not (data.get("reason") or "").strip():
            raise HTTPException(422, detail={"code": "reason_required"})
        digest = hashlib.sha256(json.dumps({"action": action, "class_id": str(class_id), "target_id": str(target_id), "body": data}, sort_keys=True, default=str).encode()).hexdigest()
        prior = db.query(ClassOperation).filter_by(actor_id=actor_id, operation_key=data["operation_key"]).first()
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(409, detail={"code": "operation_key_reused"})
            result = prior.result
            db.commit()
            return result
        if data.get("expected_revision") != cls.revision:
            raise HTTPException(409, detail={"code": "stale_class", "revision": cls.revision})
        result = apply(cls, actor, data)
        cls.revision += 1
        result = {"class_id": str(cls.id), "revision": cls.revision, **result}
        db.add(ClassOperation(actor_id=actor_id, operation_key=data["operation_key"], request_hash=digest, class_id=cls.id, result=result))
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
