# 운영 11/17 리포트 누락 — 복구 계획 (실행 금지, 초안)

## 결론
조회 시점(16:10 KST 이후) 운영 회차 4f7ab204 는 client 리포트 30/30 completed·ready, member_report 30, 메일 sent 30.
**복구 대상 0명 — 실행할 복구 없음.** 누락처럼 보인 것은 직렬 생성 진행 중이었다.

## 복구가 필요해질 경우(초안, 읽기 확인 후 건별 승인)
세션 단위 재큐잉은 멱등(완료분 건너뜀, pending_analysis/error 만 재생성):
    cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
    /opt/mindbreeze/venv/bin/python -c "from app.tasks.report_task import generate_reports_for_session as t; t.apply_async(args=['<세션ID>'])"
메일 영향: 재생성된 client 리포트는 auto_approve 가 켜져 있으면 자동 승인 → participant.report_email 이 있고
report_email_sent_at 이 비어 있는 회원에게 **메일이 자동 발송**된다(이미 sent 인 회원은 재발송 안 됨).
