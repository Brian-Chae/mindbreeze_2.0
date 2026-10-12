"""SDD-192: 웹 푸시 VAPID 키 한 쌍 생성 — 출력값을 서버 .env 에 넣는다(개인키는 저장소에 커밋 금지)."""
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
b64=lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
k=ec.generate_private_key(ec.SECP256R1())
print("VAPID_PUBLIC_KEY="+b64(k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)))
print("VAPID_PRIVATE_KEY="+b64(k.private_numbers().private_value.to_bytes(32,"big")))
