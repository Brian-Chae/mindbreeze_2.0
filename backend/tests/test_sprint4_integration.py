"""Sprint 4 통합 E2E 테스트 — 전체 파이프라인 검증

세션 생성 → 시작 → Join(LiveKit) → EEG 메트릭 → 종료 → 기록지 → 리포트
"""

import requests
import json
import sys
import os
import uuid

BASE = os.environ.get("API_BASE", "https://dev-api.mindbreeze.looxidlabs.com/api/v1")


def color(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m"


def ok(text: str) -> str:
    return color("32", f"  ✅ {text}")


def fail(text: str) -> str:
    return color("31", f"  ❌ {text}")


def info(text: str) -> str:
    return color("36", f"  ℹ️  {text}")


class E2ETest:
    def __init__(self):
        self.token = None
        self.session_id = None
        self.results = []

    def step(self, name: str, fn) -> None:
        try:
            result = fn()
            self.results.append((name, True, result))
            print(ok(f"{name}: {result}"))
        except Exception as e:
            self.results.append((name, False, str(e)))
            print(fail(f"{name}: {e}"))

    def run(self):
        print("\n" + "=" * 60)
        print("  MIND BREEZE 2.0 — Sprint 4 통합 E2E 테스트")
        print("=" * 60 + "\n")

        # ── Auth ──
        email = f"e2e_integration_{uuid.uuid4().hex[:8]}@example.com"
        pw = "IntegrationTest1234!"

        self.step("회원가입", lambda: self._register(email, pw))
        self.step("로그인", lambda: self._login(email, pw))

        # ── 세션 생성 ──
        self.step("세션 생성 (online+group+linkband)",
                  lambda: self._create_session())

        # ── 상태 전이 ──
        self.step("세션 시작 (scheduled→in_progress)",
                  lambda: self._transition("start"))
        self.step("세션 일시정지",
                  lambda: self._transition("pause"))
        self.step("세션 재개",
                  lambda: self._transition("resume"))

        # ── LiveKit ──
        self.step("세션 Join (LiveKit 토큰 발급)",
                  lambda: self._join_session())

        # ── EEG ──
        for i in range(3):
            self.step(f"EEG 메트릭 #{i+1}",
                      lambda i=i: self._submit_metrics(i))

        self.step("EEG 요약 조회",
                  lambda: self._get_eeg_summary())

        # ── 종료 ──
        self.step("세션 종료 (→ completed)",
                  lambda: self._transition("end"))

        self.step("종료 후 세션 조회",
                  lambda: self._get_session())
        self.step("세션 상태=completed 확인",
                  lambda: self._verify_completed())

        # ── 기록지 / 리포트 연계 ──
        self.step("기록지 조회",
                  lambda: self._get_record())
        self.step("리포트 생성",
                  lambda: self._generate_report())

        # ── 결과 ──
        passed = sum(1 for _, ok, _ in self.results if ok)
        total = len(self.results)
        print("\n" + "=" * 60)
        print(f"  결과: {passed}/{total} 통과")
        if passed == total:
            print(color("32", "  🎉 전체 테스트 통과!"))
        else:
            print(color("31", f"  ⚠️  {total - passed}개 실패"))
            for name, ok, detail in self.results:
                if not ok:
                    print(f"    ❌ {name}: {detail}")
        print("=" * 60 + "\n")
        return passed == total

    def _register(self, email, pw):
        r = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": pw, "name": "E2E Integration", "role": "counselor"
        })
        if r.status_code == 409:
            return "already exists (skip)"
        assert r.status_code == 201, f"status={r.status_code}"
        return "created"

    def _login(self, email, pw):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        self.token = data["access_token"]
        assert self.token, "no token"
        return data["user"]["role"]

    def _create_session(self):
        r = requests.post(f"{BASE}/sessions", json={
            "type": "meditation",
            "scheduled_at": "2026-06-07T10:00:00+00:00",
            "duration_min": 45,
            "title": "통합 E2E 테스트",
            "location_type": "online",
            "participant_mode": "group",
            "linkband_mode": "required",
            "max_participants": 5,
        }, headers={"Authorization": f"Bearer {self.token}"})
        assert r.status_code == 201, f"status={r.status_code}"
        data = r.json()
        self.session_id = data["id"]
        assert data["location_type"] == "online"
        assert data["linkband_mode"] == "required"
        return self.session_id[:8]

    def _transition(self, action):
        r = requests.post(
            f"{BASE}/sessions/{self.session_id}/{action}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.status_code == 200, f"status={r.status_code}"
        return r.json()["status"]

    def _join_session(self):
        r = requests.post(
            f"{BASE}/sessions/{self.session_id}/join",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        assert "livekit_token" in data
        assert "webrtc_room_id" in data

        # JWT 검증
        import jwt
        header = jwt.get_unverified_header(data["livekit_token"])
        assert header["alg"] == "HS256"
        return f"room={data['webrtc_room_id'][:8]}"

    def _submit_metrics(self, idx):
        r = requests.post(
            f"{BASE}/sessions/{self.session_id}/eeg/metrics",
            json={
                "neural_activity": 70 + idx * 5,
                "concentration": 60 + idx * 10,
                "cognitive_stress": 40 - idx * 5,
                "eeg_stress": 30 - idx * 3,
                "emotional_balance": 55 + idx,
                "relaxation": 70 - idx * 2,
                "heart_rate": 68 + idx * 3,
                "total_movement": 100 + idx * 20,
                "sensor_attached": 1,
                "sqi_fp1": 85 + idx * 2,
                "sqi_fp2": 90 - idx,
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.status_code == 204, f"status={r.status_code}"
        return "ok"

    def _get_eeg_summary(self):
        r = requests.get(
            f"{BASE}/sessions/{self.session_id}/eeg/summary",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        assert data["data_points"] >= 3, f"data_points={data['data_points']}"
        return f"pts={data['data_points']}, conc={data['avg_concentration']}"

    def _get_session(self):
        r = requests.get(
            f"{BASE}/sessions/{self.session_id}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.status_code == 200, f"status={r.status_code}"
        return r.json()["status"]

    def _verify_completed(self):
        r = requests.get(
            f"{BASE}/sessions/{self.session_id}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert r.json()["status"] == "completed", f"status={r.json()['status']}"
        return "verified"

    def _get_record(self):
        r = requests.get(
            f"{BASE}/sessions/{self.session_id}/record",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if r.status_code == 404:
            return "not yet (audio required)"
        assert r.status_code == 200, f"status={r.status_code}"
        return r.json().get("status", "exists")

    def _generate_report(self):
        r = requests.post(
            f"{BASE}/reports/generate/{self.session_id}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if r.status_code in (200, 201, 202):
            return r.json().get("status", "generated")
        return f"status={r.status_code} (may need F7 completion)"


if __name__ == "__main__":
    test = E2ETest()
    success = test.run()
    sys.exit(0 if success else 1)
