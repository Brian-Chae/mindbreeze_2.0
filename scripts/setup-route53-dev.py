# ──────────────────────────────────────
# MIND BREEZE 2.0 — Route 53 Dev DNS 설정
# 실행: python3 scripts/setup-route53-dev.py
# ──────────────────────────────────────
import boto3, sys

EC2_IP = sys.argv[1] if len(sys.argv) > 1 else None
if not EC2_IP:
    print("사용법: python3 scripts/setup-route53-dev.py <EC2_IP>")
    sys.exit(1)

r53 = boto3.client('route53', region_name='ap-northeast-1')
zone_id = '/hostedzone/Z061081436L4M61L2W9NR'

changes = [
    # 기존 mindbreeze CNAME 삭제 (Tailscale → EC2 IP로 교체)
    {
        'Action': 'DELETE',
        'ResourceRecordSet': {
            'Name': 'mindbreeze.looxidlabs.com',
            'Type': 'CNAME',
            'TTL': 300,
            'ResourceRecords': [{'Value': 'brian-macmini.taila00d2a.ts.net'}]
        }
    },
    # Dev FE
    {
        'Action': 'CREATE',
        'ResourceRecordSet': {
            'Name': 'dev.mindbreeze.looxidlabs.com',
            'Type': 'A',
            'TTL': 300,
            'ResourceRecords': [{'Value': EC2_IP}]
        }
    },
    # Dev BE
    {
        'Action': 'CREATE',
        'ResourceRecordSet': {
            'Name': 'dev-api.mindbreeze.looxidlabs.com',
            'Type': 'A',
            'TTL': 300,
            'ResourceRecords': [{'Value': EC2_IP}]
        }
    },
]

print(f"DNS 레코드 업데이트 중... (EC2 IP: {EC2_IP})")
result = r53.change_resource_record_sets(
    HostedZoneId=zone_id,
    ChangeBatch={
        'Comment': 'Mindbreeze Dev DNS',
        'Changes': changes
    }
)
print(f"✅ 완료! Status: {result['ChangeInfo']['Status']}")
