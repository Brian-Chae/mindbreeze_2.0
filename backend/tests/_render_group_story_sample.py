"""수동 실행용: 그룹 기록 리포트 PDF → PNG. pytest -s tests/_render_group_story_sample.py -k sample"""
import subprocess
from pathlib import Path

from app.services import member_report_book as book
from app.services import member_report_builder as builder
from tests.test_sdd329_group_story import _world
from tests.test_member_report_builder import _no_side_effects, db  # noqa: F401


def test_sample(db):
    out_dir = Path.home() / ".hermes/share/sdd329-shots"
    for n, tag in ((10, "n10"), (4, "n4")):
        world = _world(db, n)
        out = builder.build_member_report(db, world["session"].id, world["participants"][0].id)
        pdf = book.render_member_report_book(out)
        f = out_dir / f"group-story-{tag}.pdf"
        f.write_bytes(pdf)
        subprocess.run(["pdftoppm", "-png", "-r", "70", str(f), str(out_dir / f"group-story-{tag}")], check=True)
