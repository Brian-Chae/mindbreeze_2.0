"""응답 형태 골든 기록·대조기 (SDD-211 C3).

비교 모드: 라벨별 골든의 `status`(정확히 일치)와 `shape`(가산 호환, `strict_keys` 면 키 집합 봉인)를 대조한다.
갱신 모드(`UPDATE_CONTRACT_GOLDEN=1`, CI 제외): 실행된 라벨만 기존 골든에 병합해 쓴다.
"""

from __future__ import annotations

from typing import Any

from tests.contract import golden_io, shape

GOLDEN_NAME = "sessions_shapes.json"


class ShapeRecorder:
    def __init__(self) -> None:
        self._recorded: dict[str, dict[str, Any]] = {}
        self._golden: dict[str, dict[str, Any]] | None = None

    def _load(self) -> dict[str, dict[str, Any]]:
        if self._golden is None:
            try:
                self._golden = golden_io.load_golden(GOLDEN_NAME)
            except FileNotFoundError:
                self._golden = {}
        return self._golden

    def check(self, label: str, response: Any, *, strict_keys: bool = False) -> Any:
        """응답을 골든과 대조(또는 기록)하고 파싱된 JSON 본문을 돌려준다(본문이 JSON 이 아니면 None)."""
        content_type = response.headers.get("content-type", "")
        body = response.json() if "json" in content_type and response.content else None
        current = {"status": response.status_code, "shape": shape.shape_of(body), "content_type": content_type.split(";")[0]}
        if strict_keys:
            current["strict_keys"] = True

        if golden_io.update_requested():
            self._recorded[label] = current
            return body

        golden = self._load().get(label)
        assert golden is not None, f"골든에 라벨 {label} 이 없다 — UPDATE_CONTRACT_GOLDEN=1 로 생성하라"
        assert response.status_code == golden["status"], f"{label}: 상태코드 {golden['status']} → {response.status_code}"
        assert current["content_type"] == golden["content_type"], f"{label}: content-type 변경"
        problems = shape.compare_shape(golden["shape"], current["shape"], strict_keys=bool(golden.get("strict_keys")))
        assert problems == [], f"{label}: " + "; ".join(problems)
        return body

    def flush(self) -> None:
        if not self._recorded:
            return
        merged = {**self._load(), **self._recorded}
        golden_io.write_golden(GOLDEN_NAME, merged)
