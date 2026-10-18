"""SDD-212 dev 롤아웃 — deploy-dev.yml 이 신규 일꾼 유닛 2종을 설치·기동한다 (verify D-01~D-07)

서버에 접속하지 않는다. 워크플로 본문과 스크립트 텍스트만 검사한다.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WF = (ROOT / ".github" / "workflows" / "deploy-dev.yml").read_text(encoding="utf-8")
NEW_UNITS = ("mindbreeze-stt-worker", "mindbreeze-report-worker")


def _script_lines() -> list[str]:
    return WF.splitlines()


def _first_index(pattern: str) -> int:
    for i, line in enumerate(_script_lines()):
        if re.search(pattern, line):
            return i
    raise AssertionError(f"패턴 없음: {pattern}")


def test_D01_번들에_신규_유닛_파일이_포함된다():
    for unit in NEW_UNITS:
        assert re.search(rf"^\s+backend/deploy/{unit}\.service \\$", WF, re.M)


def test_D02_설치는_cp_daemon_reload_enable_이고_멱등이다():
    for unit in NEW_UNITS:
        assert (
            f'sudo cp "$BASE/backend/deploy/{unit}.service" /etc/systemd/system/{unit}.service' in WF
        )
        assert f"systemctl enable {unit}" in WF
    # 설치 단계는 파일 덮어쓰기·enable 만 사용 (줄 추가 누적 방식 금지)
    assert not re.search(rf">>\s*/etc/systemd/system/{NEW_UNITS[0]}", WF)


def test_D03_신규_유닛_재시작이_백엔드와_기존_일꾼보다_앞이다():
    stt = _first_index(r"systemctl restart mindbreeze-stt-worker")
    report = _first_index(r"systemctl restart mindbreeze-report-worker")
    backend = _first_index(r"^\s+sudo systemctl restart mindbreeze-backend$")
    worker = _first_index(r"^\s+sudo systemctl restart mindbreeze-worker$")
    assert stt < backend and report < backend
    assert stt < worker and report < worker


def test_D04_활성_확인_실패는_스크립트를_실패시킨다():
    for unit in NEW_UNITS:
        line = next(l for l in _script_lines() if f"systemctl is-active {unit}" in l)
        # `|| true` 로 실패를 삼키면 롤백 트랩이 발동하지 않는다
        assert "|| true" not in line, line


def test_D05_롤백_트랩이_신규_유닛도_재시작한다():
    start = _first_index(r"^\s+rollback\(\) \{")
    end = _first_index(r"^\s+trap rollback EXIT")
    body = "\n".join(_script_lines()[start:end])
    for unit in NEW_UNITS:
        assert f"systemctl restart {unit}" in body


def test_D06_워크플로는_분리_플래그를_건드리지_않는다():
    assert "PIPELINE_QUEUE_SPLIT_ENABLED=" not in WF  # 설정 쓰기 금지(주석 언급은 허용)


def test_D07_컷오버_dev_중지_목록에_신규_유닛이_포함된다():
    body = (ROOT / "deploy/cutover/lib.sh").read_text(encoding="utf-8")
    line = next(l for l in body.splitlines() if l.startswith("DEV_SERVICES="))
    for unit in NEW_UNITS:
        assert unit in line
