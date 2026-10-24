"""SDD-237 B8/R2~R5: 상담(1:1) 도메인은 변경 전과 동일하다.

- 상담 세션의 상담사용 리포트 content 키·값은 class_report 추가 이전의 생성기와 같다.
- report_narrative 의 공용 헬퍼 추출(segment_halves·direction_for_change)은 동작을 바꾸지 않는다(원본 구현과 대조).
"""

import random
import uuid
from types import SimpleNamespace

import pytest

from app.models.record import Report
from app.models.session import Session
from app.services import report_narrative as rn
from app.services.eeg_metrics import mean
from app.tasks import report_task
from tests.sdd237_helpers import auth_for, make_user


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _counseling_report(db):
    host = make_user(db, name="상담사")
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=host.id, is_template=True,
                duration_min=50)
    db.add(s)
    db.flush()
    rep = Report(id=uuid.uuid4(), session_id=s.id, user_id=host.id, type="counselor",
                 status="pending_analysis", content={"status": "generating"})
    db.add(rep)
    db.commit()
    return host, s, rep


def test_상담_리포트_content는_종전_생성기_결과와_정확히_같다(client, db):
    host, s, rep = _counseling_report(db)
    out = report_task.generate_report_inline(str(rep.id), db)
    expected_keys = {"title", "session_type", "scheduled_at", "markers", "counselor_notes", "eeg", "ai_record",
                     "transcript_segments", "video", "approved"}
    assert set(out.content) == expected_keys
    assert "class_report" not in out.content
    baseline = report_task._counselor_content(s, None, out.content["eeg"])
    assert out.content == baseline


def test_상담_리포트_API_응답에_class_report가_없다(client, db):
    host, s, rep = _counseling_report(db)
    report_task.generate_report_inline(str(rep.id), db)
    res = client.get(f"/api/v1/reports/{rep.id}", headers=auth_for(host))
    assert res.status_code == 200
    assert "class_report" not in res.json()["content"]


def test_상담_세션은_요약_리포트_수정_API가_모두_400(client, db):
    host, s, rep = _counseling_report(db)
    h = auth_for(host)
    assert client.get(f"/api/v1/sessions/{s.id}/class-summary", headers=h).status_code == 400
    assert client.get(f"/api/v1/sessions/{s.id}/class-report", headers=h).status_code == 400
    assert client.patch(f"/api/v1/sessions/{s.id}/class-report/narrative",
                        json={"field": "headline", "text": "x"}, headers=h).status_code == 400


# ── 공용 헬퍼 추출이 build_metrics_summary 를 바꾸지 않았다 ──────────────
def _original_build_metrics_summary(windows, session_status):
    """SDD-237 이전 report_narrative.build_metrics_summary 원본(검증 기준)."""
    mixed = len({getattr(w, "participant_id", None) for w in windows}) > 1
    segments = {}
    for w in windows:
        segments.setdefault(getattr(w, "play_group_id", None), []).append(w)
    segment_halves = []
    for seg_windows in segments.values():
        midpoint = ((min(w.window_index for w in seg_windows) + max(w.window_index for w in seg_windows)) / 2
                    if seg_windows else 0)
        segment_halves.append(([w for w in seg_windows if w.window_index < midpoint],
                               [w for w in seg_windows if w.window_index >= midpoint]))

    def _half_mean(half, attr, group):
        return mean([getattr(w, attr, None) for w in half
                     if not mixed and (group == "body" or (
                         session_status in ("valid", "degraded") and w.quality in ("valid", "degraded")))])

    result = {"session_status": session_status, "body": {}, "mind": {}}
    for group, mapping in rn.METRICS.items():
        for key, (attr, threshold) in mapping.items():
            early = mean([_half_mean(eh, attr, group) for eh, _ in segment_halves])
            late = mean([_half_mean(lh, attr, group) for _, lh in segment_halves])
            delta = late - early if early is not None and late is not None else None
            pct = delta / abs(early) * 100 if delta is not None and early != 0 else None
            direction = None
            if delta is not None:
                stable = (abs(delta) < threshold if threshold is not None else
                          (abs(pct) < 5 if pct is not None else delta == 0))
                direction = "stable" if stable else ("up" if delta > 0 else "down")
            result[group][key] = {"early": early, "late": late, "delta": delta, "percent_change": pct,
                                  "direction": direction}
    return result


def _random_windows(rng):
    wins = []
    people = [f"p{i}" for i in range(rng.choice([1, 1, 2, 3]))]
    for pid in people:
        for seg in rng.sample([None, "g1", "g2"], rng.randint(1, 3)):
            for i in range(rng.randint(0, 40)):
                def val(lo, hi):
                    return None if rng.random() < 0.15 else rng.uniform(lo, hi)
                wins.append(SimpleNamespace(
                    participant_id=pid, play_group_id=seg, window_index=i,
                    quality=rng.choice(["valid", "degraded", "invalid"]),
                    respiratory_rate=val(8, 20), heart_rate=val(50, 90), sdnn=val(20, 80),
                    focus_index=val(0, 100), relaxation_index=val(0, 100), emotional_stability=val(0, 100)))
    return wins


@pytest.mark.parametrize("seed", range(40))
def test_build_metrics_summary_는_원본_구현과_결과가_같다(seed):
    rng = random.Random(seed)
    wins = _random_windows(rng)
    status = rng.choice(["valid", "degraded", "invalid"])
    assert rn.build_metrics_summary(wins, status) == _original_build_metrics_summary(wins, status)
