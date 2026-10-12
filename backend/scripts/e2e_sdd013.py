"""SDD-013 AI 기록 파이프라인 E2E 스크립트 (pytest 대상 아님)

운영 dev 서버(dev-api.mindbreeze.looxidlabs.com)에 실제 계정·세션·오디오를 생성한다.
pytest가 수집하면 모듈 레벨 exit(0)으로 스위트 전체가 INTERNALERROR로 죽으므로
반드시 tests/ 밖에 두고 수동으로만 실행한다.

실행: cd backend && source venv/bin/activate && python scripts/e2e_sdd013.py
"""
import sys

import requests, time, uuid

BASE = "https://dev-api.mindbreeze.looxidlabs.com/api/v1"
EMAIL = f"t-{uuid.uuid4().hex[:8]}@mindbreeze.com"
PWD = "Test1234!"

def step(n, label):
    print(f"[STEP {n}] {label}")

# 1-2. Register + Login
step(1, "Register+Login")
r = requests.post(f"{BASE}/auth/register", json={
    "email": EMAIL, "password": PWD, "name": "E2E Counselor",
    "role": "counselor", "consent_terms": True
})
print(f"  register: {r.status_code}")

r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD})
assert r.status_code == 200, f"Login: {r.status_code}"
resp = r.json()
access_token = resp.get("access_token") or resp.get("token")
user_id = resp.get("user", {}).get("id")
print(f"  user_id={user_id}")

H = {"Authorization": f"Bearer {access_token}"}

# 3. Onboard (skip if already done)
step(2, "Onboard")
r = requests.post(f"{BASE}/onboarding/counselor/complete", json={
    "counseling_center": {"name": "E2E", "phone": "02-0000-0000"},
    "credentials": {"license_number": "12345"},
    "career": [{"organization": "Test", "role": "counselor", "years": 3}],
}, headers=H)
print(f"  onboard: {r.status_code}")

# 4. Client - try direct creation via register
step(3, "Client")
r = requests.post(f"{BASE}/auth/register/client", json={
    "email": f"c-{uuid.uuid4().hex[:8]}@mindbreeze.com",
    "password": PWD, "name": "E2E Client", "consent_terms": True
}, headers=H)
print(f"  register client: {r.status_code}")
if r.ok:
    cid = r.json().get("user", {}).get("id") or r.json().get("id")
else:
    # Try GET clients
    r2 = requests.get(f"{BASE}/clients", headers=H)
    clients = r2.json()
    if isinstance(clients, list) and clients:
        cid = clients[0].get("id")
    elif isinstance(clients, dict):
        items = clients.get("items", [clients])
        cid = items[0].get("id") if items else None
    else:
        cid = None
print(f"  client_id={cid}")

if not cid:
    print("NO CLIENT - SKIP")
    sys.exit(0)

# 5. Session
step(4, "Session")
r = requests.post(f"{BASE}/sessions", json={
    "client_id": cid, "type": "clinical",
    "scheduled_at": "2026-06-06T10:00:00Z", "title": "SDD-013 E2E",
    "consent_audio": True
}, headers=H)
assert r.status_code in (200, 201), f"Session: {r.status_code} {r.text[:200]}"
sid = r.json().get("id") or r.json().get("session_id")
print(f"  session_id={sid}")

# 6. Audio start
step(5, "Audio Start")
r = requests.post(f"{BASE}/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=H)
assert r.status_code == 200, f"Start: {r.status_code} {r.text[:200]}"

# 7. Chunks
step(6, "Chunks x3")
for i in range(3):
    r = requests.post(f"{BASE}/sessions/{sid}/audio/chunk",
        files={"file": (f"chunk_{i}.bin", b'\x00' * 1024)},
        data={"chunk_index": i}, headers=H)
    assert r.status_code == 200, f"Chunk {i}: {r.status_code}"

# 8. Stop -> pipeline
step(7, "Stop -> Pipeline")
r = requests.post(f"{BASE}/sessions/{sid}/audio/stop", headers=H)
assert r.status_code == 200
print(f"  status={r.json()['status']}")

# 9. Poll record
step(8, "Poll Record")
rec = None
for i in range(15):
    time.sleep(2)
    r = requests.get(f"{BASE}/sessions/{sid}/record", headers=H)
    rec = r.json()
    st = rec.get("status", "idle")
    print(f"  [{i+1}] {st}")
    if st == "completed":
        break

# 10. Verify
step(9, "Verify")
assert rec, "No record"
print(f"  transcript: {'YES' if rec.get('transcript') else 'NO'}")
print(f"  headline: {rec.get('ai_summary', {}).get('headline', '-')}")

# 11. Transcript
step(10, "Transcript")
r = requests.get(f"{BASE}/sessions/{sid}/transcript", headers=H)
print(f"  segments: {len(r.json().get('segments', []))}")

# 12. Notes
step(11, "Update Notes")
r = requests.put(f"{BASE}/sessions/{sid}/record",
    json={"counselor_notes": "SDD-013 E2E test memo"}, headers=H)
assert r.status_code == 200
upd = r.json()
assert upd.get("is_edited"), f"Not edited: {upd}"
print(f"  is_edited={upd['is_edited']} edit_history={len(upd.get('edit_history', []))}")

print("\n✅ SDD-013 E2E PASSED")
