"""Google OAuth + Client Portal API 테스트"""

import pytest
from unittest.mock import patch


class TestGoogleAuth:
    """POST /api/v1/auth/google"""

    def test_위조_토큰_401(self, client):
        """Google ID token 위조 시 401"""
        with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
            mock_verify.side_effect = ValueError("Invalid token")
            res = client.post(
                "/api/v1/auth/google",
                json={"id_token": "fake-token"},
            )
            assert res.status_code == 401
            assert "유효하지 않은" in res.json()["detail"]

    def test_신규_Google_사용자_생성_200(self, client):
        """신규 Google 사용자 생성 → JWT 발급"""
        with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "google-user@test.com",
                "name": "Google User",
            }
            res = client.post(
                "/api/v1/auth/google",
                json={"id_token": "valid-token"},
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

        with patch("google.oauth2.id_token.verify_oauth2_token") as mock_verify:
            mock_verify.return_value = {
                "email": "existing@test.com",
                "name": "Existing User",
            }
            res = client.post(
                "/api/v1/auth/google",
                json={"id_token": "valid-token"},
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
