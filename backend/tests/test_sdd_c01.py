"""Google OAuth + Client Portal API 테스트"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestGoogleAuth:
    """POST /api/v1/auth/google

    실제 구현은 Google userinfo API를 access_token으로 호출한다.
    따라서 httpx.AsyncClient.get 을 모킹한다.
    """

    @staticmethod
    def _userinfo_mock(status_code: int, payload: dict | None = None):
        """Google userinfo 응답을 흉내내는 AsyncMock 생성"""
        resp = MagicMock()
        resp.status_code = status_code
        resp.json.return_value = payload or {}
        return AsyncMock(return_value=resp)

    def test_위조_토큰_401(self, client):
        """Google access token 위조 시 401"""
        with patch("httpx.AsyncClient.get", self._userinfo_mock(401)):
            res = client.post(
                "/api/v1/auth/google",
                json={"access_token": "fake-token"},
            )
            assert res.status_code == 401
            assert "유효하지 않은" in res.json()["detail"]

    def test_신규_Google_사용자_생성_200(self, client):
        """신규 Google 사용자 생성 → JWT 발급"""
        mock_get = self._userinfo_mock(
            200, {"email": "google-user@test.com", "name": "Google User"}
        )
        with patch("httpx.AsyncClient.get", mock_get):
            res = client.post(
                "/api/v1/auth/google",
                json={"access_token": "valid-token"},
            )
            assert res.status_code == 200
            data = res.json()
            assert "access_token" in data
            assert data["user"]["email"] == "google-user@test.com"
            assert data["user"]["auth_provider"] == "google"
            assert data["user"]["role"] == "client"
            assert data["user"]["counselors"] == []

    def test_기존_이메일_사용자_Google_로그인_200(self, client):
        """기존 이메일 사용자가 Google로 로그인 → auth_provider 업데이트"""
        # 먼저 이메일로 사용자 생성
        client.post(
            "/api/v1/auth/register",
            json={
                "email": "existing@test.com",
                "password": "Test1234!",
                "name": "Existing User",
                "role": "client",
            },
        )

        mock_get = self._userinfo_mock(
            200, {"email": "existing@test.com", "name": "Existing User"}
        )
        with patch("httpx.AsyncClient.get", mock_get):
            res = client.post(
                "/api/v1/auth/google",
                json={"access_token": "valid-token"},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["user"]["email"] == "existing@test.com"
            assert data["user"]["auth_provider"] == "google"


class TestClientPortal:
    """GET/POST /api/v1/client/counselors — JWT 인증 필요, 통합 환경에서 검증"""

    @pytest.mark.skip(reason="JWT auth fixture needed for client portal integration test")
    def test_상담사_목록_빈_상태_200(self, client):
        """연결된 상담사가 없을 때 빈 배열 반환"""
        ...
