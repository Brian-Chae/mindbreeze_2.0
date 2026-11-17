"""SDD-323 — 기계 판독용 `code` 를 함께 내려주는 HTTP 예외.

응답 본문: ``{"detail": "<한글 문구>", "code": "<ERROR_CODE>", ...extra}``.
HTTPException 하위 클래스이므로 기존 ``except HTTPException`` / 상태코드 단언과 호환된다.
"""

from typing import Any

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.extra = extra
