# 라우트 측정 커버리지

| 경로 | 역할 | 폭 | 실제 경로 | 상태 | 오류 / 미등록 API | 캡처 |
|---|---|---:|---|---|---|---|
| `/app/ai` | client | 1440 | `/app/chat/lucy` | 리다이렉트 | 없음 | [PNG](captures/client-1440-app-ai.png) |
| `/app/*` | client | 1440 | `/app/audit-unknown` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-audit-unknown.png) |
| `/app/chat/lucy` | client | 1440 | `/app/chat/lucy` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-chat-lucy.png) |
| `/app/chat/sample-room` | client | 1440 | `/app/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-chat-sample-room.png) |
| `/app/chat` | client | 1440 | `/app/chat` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-chat.png) |
| `/app/classes/:classId` | client | 1440 | `/app/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-classes-sample-class.png) |
| `/app/classes` | client | 1440 | `/app/classes` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-classes.png) |
| `/app/counseling/:relationshipId` | client | 1440 | `/app/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-counseling-sample-relationship.png) |
| `/app/counseling` | client | 1440 | `/app/counseling` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-counseling.png) |
| `/app/notifications` | client | 1440 | `/app/notifications` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-notifications.png) |
| `/app/participation-profile` | client | 1440 | `/app/participation-profile` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-participation-profile.png) |
| `/app/profile` | client | 1440 | `/app/profile` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-profile.png) |
| `/app/reports?report=sample-report` | client | 1440 | `/app/reports` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-reports-report-sample-report.png) |
| `/app/reports` | client | 1440 | `/app/reports` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-reports.png) |
| `/app/sessions/sample-session` | client | 1440 | `/app/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app-sessions-sample-session.png) |
| `/app/sessions` | client | 1440 | `/app/classes` | 리다이렉트 | 없음 | [PNG](captures/client-1440-app-sessions.png) |
| `/app` | client | 1440 | `/app` | 렌더 표본 | 없음 | [PNG](captures/client-1440-app.png) |
| `/chat/:roomId` | client | 1440 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/client-1440-chat-sample-room.png) |
| `/chat` | client | 1440 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/client-1440-chat.png) |
| `/design/class-player?role=member&case=M02` | client | 1440 | `/design/class-player` | 시안(비범위) | 없음 | [PNG](captures/client-1440-design-class-player-role-member-case-M02.png) |
| `/notifications` | client | 1440 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/client-1440-notifications.png) |
| `/onboarding/client/essentials` | client | 1440 | `/onboarding/client/essentials` | 렌더 표본 | 없음 | [PNG](captures/client-1440-onboarding-client-essentials.png) |
| `/onboarding/client` | client | 1440 | `/onboarding/client` | 렌더 표본 | 없음 | [PNG](captures/client-1440-onboarding-client.png) |
| `/org/requests` | client | 1440 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/client-1440-org-requests.png) |
| `/playground` | client | 1440 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/client-1440-playground.png) |
| `/sessions/:id/live` | client | 1440 | `/sessions/sample-session/player` | 리다이렉트 | 없음 | [PNG](captures/client-1440-sessions-sample-session-live.png) |
| `/sessions/:id/player` | client | 1440 | `/sessions/sample-session/player` | 플레이어(제외 제안) | 없음 | [PNG](captures/client-1440-sessions-sample-session-player.png) |
| `/sessions/:id/record` | client | 1440 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/client-1440-sessions-sample-session-record.png) |
| `/settings` | client | 1440 | `/app/profile` | 리다이렉트 | 없음 | [PNG](captures/client-1440-settings.png) |
| `/app/ai` | client | 390 | `/app/chat/lucy` | 리다이렉트 | 없음 | [PNG](captures/client-390-app-ai.png) |
| `/app/*` | client | 390 | `/app/audit-unknown` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-audit-unknown.png) |
| `/app/chat/lucy` | client | 390 | `/app/chat/lucy` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-chat-lucy.png) |
| `/app/chat/sample-room` | client | 390 | `/app/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-chat-sample-room.png) |
| `/app/chat` | client | 390 | `/app/chat` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-chat.png) |
| `/app/classes/:classId` | client | 390 | `/app/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-classes-sample-class.png) |
| `/app/classes` | client | 390 | `/app/classes` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-classes.png) |
| `/app/counseling/:relationshipId` | client | 390 | `/app/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-counseling-sample-relationship.png) |
| `/app/counseling` | client | 390 | `/app/counseling` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-counseling.png) |
| `/app/notifications` | client | 390 | `/app/notifications` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-notifications.png) |
| `/app/participation-profile` | client | 390 | `/app/participation-profile` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-participation-profile.png) |
| `/app/profile` | client | 390 | `/app/profile` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-profile.png) |
| `/app/reports?report=sample-report` | client | 390 | `/app/reports` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-reports-report-sample-report.png) |
| `/app/reports` | client | 390 | `/app/reports` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-reports.png) |
| `/app/sessions/sample-session` | client | 390 | `/app/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/client-390-app-sessions-sample-session.png) |
| `/app/sessions` | client | 390 | `/app/classes` | 리다이렉트 | 없음 | [PNG](captures/client-390-app-sessions.png) |
| `/app` | client | 390 | `/app` | 렌더 표본 | 없음 | [PNG](captures/client-390-app.png) |
| `/chat/:roomId` | client | 390 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/client-390-chat-sample-room.png) |
| `/chat` | client | 390 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/client-390-chat.png) |
| `/design/class-player?role=member&case=M02` | client | 390 | `/design/class-player` | 시안(비범위) | 없음 | [PNG](captures/client-390-design-class-player-role-member-case-M02.png) |
| `/notifications` | client | 390 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/client-390-notifications.png) |
| `/onboarding/client/essentials` | client | 390 | `/onboarding/client/essentials` | 렌더 표본 | 없음 | [PNG](captures/client-390-onboarding-client-essentials.png) |
| `/onboarding/client` | client | 390 | `/onboarding/client` | 렌더 표본 | 없음 | [PNG](captures/client-390-onboarding-client.png) |
| `/org/requests` | client | 390 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/client-390-org-requests.png) |
| `/playground` | client | 390 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/client-390-playground.png) |
| `/sessions/:id/live` | client | 390 | `/sessions/sample-session/player` | 리다이렉트 | 없음 | [PNG](captures/client-390-sessions-sample-session-live.png) |
| `/sessions/:id/player` | client | 390 | `/sessions/sample-session/player` | 플레이어(제외 제안) | 없음 | [PNG](captures/client-390-sessions-sample-session-player.png) |
| `/sessions/:id/record` | client | 390 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/client-390-sessions-sample-session-record.png) |
| `/settings` | client | 390 | `/app/profile` | 리다이렉트 | 없음 | [PNG](captures/client-390-settings.png) |
| `/agent` | counselor | 1440 | `/chat/lucy` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-agent.png) |
| `/chat/:roomId` | counselor | 1440 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-chat-sample-room.png) |
| `/chat` | counselor | 1440 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-chat.png) |
| `/classes/new` | counselor | 1440 | `/classes/new` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-new.png) |
| `/classes/now` | counselor | 1440 | `/classes/now` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-now.png) |
| `/classes/:classId/members` | counselor | 1440 | `/classes/sample-class/members` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class-members.png) |
| `/classes/:classId/schedule` | counselor | 1440 | `/classes/sample-class/schedule` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class-schedule.png) |
| `/classes/:classId/sessions/:id` | counselor | 1440 | `/classes/sample-class/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class-sessions-sample-session.png) |
| `/classes/:classId/sessions` | counselor | 1440 | `/classes/sample-class/sessions` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class-sessions.png) |
| `/classes/:classId/settings` | counselor | 1440 | `/classes/sample-class/settings` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class-settings.png) |
| `/classes/:classId` | counselor | 1440 | `/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes-sample-class.png) |
| `/classes` | counselor | 1440 | `/classes` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-classes.png) |
| `/clients/invite` | counselor | 1440 | `/clients/invite` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-clients-invite.png) |
| `/clients/:id` | counselor | 1440 | `/clients/sample-client` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-clients-sample-client.png) |
| `/clients` | counselor | 1440 | `/clients` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-clients.png) |
| `/counseling/new` | counselor | 1440 | `/counseling/new` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-counseling-new.png) |
| `/counseling/:relationshipId/sessions/:id` | counselor | 1440 | `/counseling/sample-relationship/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-counseling-sample-relationship-sessions-sample-session.png) |
| `/counseling/:relationshipId` | counselor | 1440 | `/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-counseling-sample-relationship.png) |
| `/counseling` | counselor | 1440 | `/counseling` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-counseling.png) |
| `/credentials` | counselor | 1440 | `/credentials` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-credentials.png) |
| `/dashboard` | counselor | 1440 | `/dashboard` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-dashboard.png) |
| `/design/app` | counselor | 1440 | `/design/app` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-app.png) |
| `/design/class-flow` | counselor | 1440 | `/design/class-flow` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-class-flow.png) |
| `/design/class-player` | counselor | 1440 | `/design/class-player` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-class-player.png) |
| `/design/docs` | counselor | 1440 | `/design/docs` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-docs.png) |
| `/design/homepage` | counselor | 1440 | `/design/homepage` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-homepage.png) |
| `/design/report` | counselor | 1440 | `/design/report` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-report.png) |
| `/design/user-app` | counselor | 1440 | `/design/user-app` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design-user-app.png) |
| `/design` | counselor | 1440 | `/design` | 시안(비범위) | 없음 | [PNG](captures/counselor-1440-design.png) |
| `/membership-invite?token=synthetic-invite-token` | counselor | 1440 | `/membership-invite` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-membership-invite-token-synthetic-invite-token.png) |
| `/membership-invite` | counselor | 1440 | `/membership-invite` | 토큰 미제공 안내 | 없음 | [PNG](captures/counselor-1440-membership-invite.png) |
| `/notifications` | counselor | 1440 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-notifications.png) |
| `/onboarding/counselor` | counselor | 1440 | `/onboarding/counselor` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-onboarding-counselor.png) |
| `/org/requests` | counselor | 1440 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-org-requests.png) |
| `/org/:org_id` | counselor | 1440 | `/org/sample-org` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-org-sample-org.png) |
| `/org/search` | counselor | 1440 | `/org/search` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-org-search.png) |
| `/playground` | counselor | 1440 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-playground.png) |
| `/profile/professional` | counselor | 1440 | `/profile/professional` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-profile-professional.png) |
| `/reports/:id` | counselor | 1440 | `/reports/sample-report` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-reports-sample-report.png) |
| `/reports` | counselor | 1440 | `/reports` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-reports.png) |
| `/sessions/new` | counselor | 1440 | `/classes/new` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-sessions-new.png) |
| `/sessions/:id/class-report` | counselor | 1440 | `/sessions/sample-session/class-report` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session-class-report.png) |
| `/sessions/:id/live` | counselor | 1440 | `/sessions/sample-session/summary` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session-live.png) |
| `/sessions/:id/player` | counselor | 1440 | `/sessions/sample-session/summary` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session-player.png) |
| `/sessions/:id/record` | counselor | 1440 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session-record.png) |
| `/sessions/:id/summary` | counselor | 1440 | `/sessions/sample-session/summary` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session-summary.png) |
| `/sessions/:id` | counselor | 1440 | `/classes/sample-class/sessions/sample-session` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-sessions-sample-session.png) |
| `/sessions` | counselor | 1440 | `/classes` | 리다이렉트 | 없음 | [PNG](captures/counselor-1440-sessions.png) |
| `/settings` | counselor | 1440 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/counselor-1440-settings.png) |
| `/agent` | counselor | 390 | `/chat/lucy` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-agent.png) |
| `/chat/:roomId` | counselor | 390 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-chat-sample-room.png) |
| `/chat` | counselor | 390 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-chat.png) |
| `/classes/new` | counselor | 390 | `/classes/new` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-new.png) |
| `/classes/now` | counselor | 390 | `/classes/now` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-now.png) |
| `/classes/:classId/members` | counselor | 390 | `/classes/sample-class/members` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class-members.png) |
| `/classes/:classId/schedule` | counselor | 390 | `/classes/sample-class/schedule` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class-schedule.png) |
| `/classes/:classId/sessions/:id` | counselor | 390 | `/classes/sample-class/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class-sessions-sample-session.png) |
| `/classes/:classId/sessions` | counselor | 390 | `/classes/sample-class/sessions` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class-sessions.png) |
| `/classes/:classId/settings` | counselor | 390 | `/classes/sample-class/settings` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class-settings.png) |
| `/classes/:classId` | counselor | 390 | `/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes-sample-class.png) |
| `/classes` | counselor | 390 | `/classes` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-classes.png) |
| `/clients/invite` | counselor | 390 | `/clients/invite` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-clients-invite.png) |
| `/clients/:id` | counselor | 390 | `/clients/sample-client` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-clients-sample-client.png) |
| `/clients` | counselor | 390 | `/clients` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-clients.png) |
| `/counseling/new` | counselor | 390 | `/counseling/new` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-counseling-new.png) |
| `/counseling/:relationshipId/sessions/:id` | counselor | 390 | `/counseling/sample-relationship/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-counseling-sample-relationship-sessions-sample-session.png) |
| `/counseling/:relationshipId` | counselor | 390 | `/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-counseling-sample-relationship.png) |
| `/counseling` | counselor | 390 | `/counseling` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-counseling.png) |
| `/credentials` | counselor | 390 | `/credentials` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-credentials.png) |
| `/dashboard` | counselor | 390 | `/dashboard` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-dashboard.png) |
| `/design/app` | counselor | 390 | `/design/app` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-app.png) |
| `/design/class-flow` | counselor | 390 | `/design/class-flow` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-class-flow.png) |
| `/design/class-player` | counselor | 390 | `/design/class-player` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-class-player.png) |
| `/design/docs` | counselor | 390 | `/design/docs` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-docs.png) |
| `/design/homepage` | counselor | 390 | `/design/homepage` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-homepage.png) |
| `/design/report` | counselor | 390 | `/design/report` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-report.png) |
| `/design/user-app` | counselor | 390 | `/design/user-app` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design-user-app.png) |
| `/design` | counselor | 390 | `/design` | 시안(비범위) | 없음 | [PNG](captures/counselor-390-design.png) |
| `/membership-invite?token=synthetic-invite-token` | counselor | 390 | `/membership-invite` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-membership-invite-token-synthetic-invite-token.png) |
| `/membership-invite` | counselor | 390 | `/membership-invite` | 토큰 미제공 안내 | 없음 | [PNG](captures/counselor-390-membership-invite.png) |
| `/notifications` | counselor | 390 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-notifications.png) |
| `/onboarding/counselor` | counselor | 390 | `/onboarding/counselor` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-onboarding-counselor.png) |
| `/org/requests` | counselor | 390 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-org-requests.png) |
| `/org/:org_id` | counselor | 390 | `/org/sample-org` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-org-sample-org.png) |
| `/org/search` | counselor | 390 | `/org/search` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-org-search.png) |
| `/playground` | counselor | 390 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-playground.png) |
| `/profile/professional` | counselor | 390 | `/profile/professional` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-profile-professional.png) |
| `/reports/:id` | counselor | 390 | `/reports/sample-report` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-reports-sample-report.png) |
| `/reports` | counselor | 390 | `/reports` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-reports.png) |
| `/sessions/new` | counselor | 390 | `/classes/new` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-sessions-new.png) |
| `/sessions/:id/class-report` | counselor | 390 | `/sessions/sample-session/class-report` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-sessions-sample-session-class-report.png) |
| `/sessions/:id/live` | counselor | 390 | `/sessions/sample-session/summary` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-sessions-sample-session-live.png) |
| `/sessions/:id/player` | counselor | 390 | `/sessions/sample-session/summary` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-sessions-sample-session-player.png) |
| `/sessions/:id/record` | counselor | 390 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-sessions-sample-session-record.png) |
| `/sessions/:id/summary` | counselor | 390 | `/sessions/sample-session/summary` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-sessions-sample-session-summary.png) |
| `/sessions/:id` | counselor | 390 | `/classes/sample-class/sessions/sample-session` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-sessions-sample-session.png) |
| `/sessions` | counselor | 390 | `/classes` | 리다이렉트 | 없음 | [PNG](captures/counselor-390-sessions.png) |
| `/settings` | counselor | 390 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/counselor-390-settings.png) |
| `/chat/:roomId` | org_admin | 1440 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-chat-sample-room.png) |
| `/chat` | org_admin | 1440 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-chat.png) |
| `/classes/new` | org_admin | 1440 | `/classes/new` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-new.png) |
| `/classes/now` | org_admin | 1440 | `/classes/now` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-now.png) |
| `/classes/:classId/members` | org_admin | 1440 | `/classes/sample-class/members` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class-members.png) |
| `/classes/:classId/schedule` | org_admin | 1440 | `/classes/sample-class/schedule` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class-schedule.png) |
| `/classes/:classId/sessions/:id` | org_admin | 1440 | `/classes/sample-class/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class-sessions-sample-session.png) |
| `/classes/:classId/sessions` | org_admin | 1440 | `/classes/sample-class/sessions` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class-sessions.png) |
| `/classes/:classId/settings` | org_admin | 1440 | `/classes/sample-class/settings` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class-settings.png) |
| `/classes/:classId` | org_admin | 1440 | `/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes-sample-class.png) |
| `/classes` | org_admin | 1440 | `/classes` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-classes.png) |
| `/clients/invite` | org_admin | 1440 | `/clients/invite` | 권한 안내 | 없음 | [PNG](captures/org_admin-1440-clients-invite.png) |
| `/clients/:id` | org_admin | 1440 | `/clients/sample-client` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-clients-sample-client.png) |
| `/clients` | org_admin | 1440 | `/clients` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-clients.png) |
| `/counseling/new` | org_admin | 1440 | `/counseling/new` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-counseling-new.png) |
| `/counseling/:relationshipId/sessions/:id` | org_admin | 1440 | `/counseling/sample-relationship/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-counseling-sample-relationship-sessions-sample-session.png) |
| `/counseling/:relationshipId` | org_admin | 1440 | `/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-counseling-sample-relationship.png) |
| `/counseling` | org_admin | 1440 | `/counseling` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-counseling.png) |
| `/credentials` | org_admin | 1440 | `/dashboard/org` | 리다이렉트 | 없음 | [PNG](captures/org_admin-1440-credentials.png) |
| `/dashboard/org` | org_admin | 1440 | `/dashboard/org` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-dashboard-org.png) |
| `/membership-invite?token=synthetic-invite-token` | org_admin | 1440 | `/membership-invite` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-membership-invite-token-synthetic-invite-token.png) |
| `/membership-invite` | org_admin | 1440 | `/membership-invite` | 토큰 미제공 안내 | 없음 | [PNG](captures/org_admin-1440-membership-invite.png) |
| `/notifications` | org_admin | 1440 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-notifications.png) |
| `/org/counselors` | org_admin | 1440 | `/org/counselors` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-org-counselors.png) |
| `/org/data-center` | org_admin | 1440 | `/org/data-center` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-org-data-center.png) |
| `/org/requests` | org_admin | 1440 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-org-requests.png) |
| `/org/:org_id` | org_admin | 1440 | `/org/sample-org` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-org-sample-org.png) |
| `/org/search` | org_admin | 1440 | `/org/search` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-org-search.png) |
| `/playground` | org_admin | 1440 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-playground.png) |
| `/profile/professional` | org_admin | 1440 | `/profile/professional` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-profile-professional.png) |
| `/reports/:id` | org_admin | 1440 | `/reports/sample-report` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-reports-sample-report.png) |
| `/reports` | org_admin | 1440 | `/reports` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-reports.png) |
| `/sessions/new` | org_admin | 1440 | `/classes/new` | 리다이렉트 | 없음 | [PNG](captures/org_admin-1440-sessions-new.png) |
| `/sessions/:id/class-report` | org_admin | 1440 | `/sessions/sample-session/class-report` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session-class-report.png) |
| `/sessions/:id/live` | org_admin | 1440 | `/sessions/sample-session/player` | 리다이렉트 | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session-live.png) |
| `/sessions/:id/player` | org_admin | 1440 | `/sessions/sample-session/player` | 플레이어(제외 제안) | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session-player.png) |
| `/sessions/:id/record` | org_admin | 1440 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session-record.png) |
| `/sessions/:id/summary` | org_admin | 1440 | `/sessions/sample-session/summary` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session-summary.png) |
| `/sessions/:id` | org_admin | 1440 | `/classes/sample-class/sessions/sample-session` | 리다이렉트 | 없음 | [PNG](captures/org_admin-1440-sessions-sample-session.png) |
| `/sessions` | org_admin | 1440 | `/classes` | 리다이렉트 | 없음 | [PNG](captures/org_admin-1440-sessions.png) |
| `/settings` | org_admin | 1440 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/org_admin-1440-settings.png) |
| `/chat/:roomId` | org_admin | 390 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-chat-sample-room.png) |
| `/chat` | org_admin | 390 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-chat.png) |
| `/classes/new` | org_admin | 390 | `/classes/new` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-new.png) |
| `/classes/now` | org_admin | 390 | `/classes/now` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-now.png) |
| `/classes/:classId/members` | org_admin | 390 | `/classes/sample-class/members` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class-members.png) |
| `/classes/:classId/schedule` | org_admin | 390 | `/classes/sample-class/schedule` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class-schedule.png) |
| `/classes/:classId/sessions/:id` | org_admin | 390 | `/classes/sample-class/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class-sessions-sample-session.png) |
| `/classes/:classId/sessions` | org_admin | 390 | `/classes/sample-class/sessions` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class-sessions.png) |
| `/classes/:classId/settings` | org_admin | 390 | `/classes/sample-class/settings` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class-settings.png) |
| `/classes/:classId` | org_admin | 390 | `/classes/sample-class` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes-sample-class.png) |
| `/classes` | org_admin | 390 | `/classes` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-classes.png) |
| `/clients/invite` | org_admin | 390 | `/clients/invite` | 권한 안내 | 없음 | [PNG](captures/org_admin-390-clients-invite.png) |
| `/clients/:id` | org_admin | 390 | `/clients/sample-client` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-clients-sample-client.png) |
| `/clients` | org_admin | 390 | `/clients` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-clients.png) |
| `/counseling/new` | org_admin | 390 | `/counseling/new` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-counseling-new.png) |
| `/counseling/:relationshipId/sessions/:id` | org_admin | 390 | `/counseling/sample-relationship/sessions/sample-session` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-counseling-sample-relationship-sessions-sample-session.png) |
| `/counseling/:relationshipId` | org_admin | 390 | `/counseling/sample-relationship` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-counseling-sample-relationship.png) |
| `/counseling` | org_admin | 390 | `/counseling` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-counseling.png) |
| `/credentials` | org_admin | 390 | `/dashboard/org` | 리다이렉트 | 없음 | [PNG](captures/org_admin-390-credentials.png) |
| `/dashboard/org` | org_admin | 390 | `/dashboard/org` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-dashboard-org.png) |
| `/membership-invite?token=synthetic-invite-token` | org_admin | 390 | `/membership-invite` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-membership-invite-token-synthetic-invite-token.png) |
| `/membership-invite` | org_admin | 390 | `/membership-invite` | 토큰 미제공 안내 | 없음 | [PNG](captures/org_admin-390-membership-invite.png) |
| `/notifications` | org_admin | 390 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-notifications.png) |
| `/org/counselors` | org_admin | 390 | `/org/counselors` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-org-counselors.png) |
| `/org/data-center` | org_admin | 390 | `/org/data-center` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-org-data-center.png) |
| `/org/requests` | org_admin | 390 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-org-requests.png) |
| `/org/:org_id` | org_admin | 390 | `/org/sample-org` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-org-sample-org.png) |
| `/org/search` | org_admin | 390 | `/org/search` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-org-search.png) |
| `/playground` | org_admin | 390 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-playground.png) |
| `/profile/professional` | org_admin | 390 | `/profile/professional` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-profile-professional.png) |
| `/reports/:id` | org_admin | 390 | `/reports/sample-report` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-reports-sample-report.png) |
| `/reports` | org_admin | 390 | `/reports` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-reports.png) |
| `/sessions/new` | org_admin | 390 | `/classes/new` | 리다이렉트 | 없음 | [PNG](captures/org_admin-390-sessions-new.png) |
| `/sessions/:id/class-report` | org_admin | 390 | `/sessions/sample-session/class-report` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-sessions-sample-session-class-report.png) |
| `/sessions/:id/live` | org_admin | 390 | `/sessions/sample-session/player` | 리다이렉트 | 없음 | [PNG](captures/org_admin-390-sessions-sample-session-live.png) |
| `/sessions/:id/player` | org_admin | 390 | `/sessions/sample-session/player` | 플레이어(제외 제안) | 없음 | [PNG](captures/org_admin-390-sessions-sample-session-player.png) |
| `/sessions/:id/record` | org_admin | 390 | `/sessions/sample-session/record` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-sessions-sample-session-record.png) |
| `/sessions/:id/summary` | org_admin | 390 | `/sessions/sample-session/summary` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-sessions-sample-session-summary.png) |
| `/sessions/:id` | org_admin | 390 | `/classes/sample-class/sessions/sample-session` | 리다이렉트 | 없음 | [PNG](captures/org_admin-390-sessions-sample-session.png) |
| `/sessions` | org_admin | 390 | `/classes` | 리다이렉트 | 없음 | [PNG](captures/org_admin-390-sessions.png) |
| `/settings` | org_admin | 390 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/org_admin-390-settings.png) |
| `/admin/applications` | platform_admin | 1440 | `/admin/applications` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-applications.png) |
| `/admin/clients` | platform_admin | 1440 | `/admin/clients` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-clients.png) |
| `/admin/data-center` | platform_admin | 1440 | `/admin/data-center` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-data-center.png) |
| `/admin/orgs` | platform_admin | 1440 | `/admin/orgs` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-orgs.png) |
| `/admin/reviews/:targetType/:id` | platform_admin | 1440 | `/admin/reviews/credential/sample-review` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-reviews-credential-sample-review.png) |
| `/admin/reviews` | platform_admin | 1440 | `/admin/reviews` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-reviews.png) |
| `/admin/users` | platform_admin | 1440 | `/admin/users` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-admin-users.png) |
| `/admin` | platform_admin | 1440 | `/admin/orgs` | 리다이렉트 | 없음 | [PNG](captures/platform_admin-1440-admin.png) |
| `/chat/:roomId` | platform_admin | 1440 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-chat-sample-room.png) |
| `/chat` | platform_admin | 1440 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-chat.png) |
| `/notifications` | platform_admin | 1440 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-notifications.png) |
| `/org/requests` | platform_admin | 1440 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-org-requests.png) |
| `/playground` | platform_admin | 1440 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-playground.png) |
| `/settings` | platform_admin | 1440 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-1440-settings.png) |
| `/admin/applications` | platform_admin | 390 | `/admin/applications` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-applications.png) |
| `/admin/clients` | platform_admin | 390 | `/admin/clients` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-clients.png) |
| `/admin/data-center` | platform_admin | 390 | `/admin/data-center` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-data-center.png) |
| `/admin/orgs` | platform_admin | 390 | `/admin/orgs` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-orgs.png) |
| `/admin/reviews/:targetType/:id` | platform_admin | 390 | `/admin/reviews/credential/sample-review` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-reviews-credential-sample-review.png) |
| `/admin/reviews` | platform_admin | 390 | `/admin/reviews` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-reviews.png) |
| `/admin/users` | platform_admin | 390 | `/admin/users` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-admin-users.png) |
| `/admin` | platform_admin | 390 | `/admin/orgs` | 리다이렉트 | 없음 | [PNG](captures/platform_admin-390-admin.png) |
| `/chat/:roomId` | platform_admin | 390 | `/chat/sample-room` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-chat-sample-room.png) |
| `/chat` | platform_admin | 390 | `/chat` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-chat.png) |
| `/notifications` | platform_admin | 390 | `/notifications` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-notifications.png) |
| `/org/requests` | platform_admin | 390 | `/org/requests` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-org-requests.png) |
| `/playground` | platform_admin | 390 | `/playground` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-playground.png) |
| `/settings` | platform_admin | 390 | `/settings` | 렌더 표본 | 없음 | [PNG](captures/platform_admin-390-settings.png) |
| `/account-deletion` | public | 1440 | `/account-deletion` | 렌더 표본 | 없음 | [PNG](captures/public-1440-account-deletion.png) |
| `*` | public | 1440 | `/audit-unknown` | 의도된 404 | 없음 | [PNG](captures/public-1440-audit-unknown.png) |
| `/class-members/:classId` | public | 1440 | `/class-members/sample-class` | 렌더 표본 | 없음 | [PNG](captures/public-1440-class-members-sample-class.png) |
| `/class/:sessionId/enter` | public | 1440 | `/class/sample-session/enter` | 렌더 표본 | 없음 | [PNG](captures/public-1440-class-sample-session-enter.png) |
| `/crisis-help` | public | 1440 | `/crisis-help` | 렌더 표본 | 없음 | [PNG](captures/public-1440-crisis-help.png) |
| `/forgot-password` | public | 1440 | `/forgot-password` | 렌더 표본 | 없음 | [PNG](captures/public-1440-forgot-password.png) |
| `/invite/:token` | public | 1440 | `/invite/sample-token` | 렌더 표본 | 없음 | [PNG](captures/public-1440-invite-sample-token.png) |
| `/join` | public | 1440 | `/join` | 렌더 표본 | 없음 | [PNG](captures/public-1440-join.png) |
| `/` | public | 1440 | `/` | 렌더 표본 | 없음 | [PNG](captures/public-1440-landing.png) |
| `/login/client` | public | 1440 | `/login` | 리다이렉트 | 없음 | [PNG](captures/public-1440-login-client.png) |
| `/login` | public | 1440 | `/login` | 렌더 표본 | 없음 | [PNG](captures/public-1440-login.png) |
| `/measurement-guide` | public | 1440 | `/measurement-guide` | 렌더 표본 | 없음 | [PNG](captures/public-1440-measurement-guide.png) |
| `/o/:org_code` | public | 1440 | `/o/SAMPLE` | 렌더 표본 | 없음 | [PNG](captures/public-1440-o-SAMPLE.png) |
| `/org/register` | public | 1440 | `/register/organization` | 리다이렉트 | 없음 | [PNG](captures/public-1440-org-register.png) |
| `/privacy` | public | 1440 | `/privacy` | 렌더 표본 | 없음 | [PNG](captures/public-1440-privacy.png) |
| `/register/*` | public | 1440 | `/register` | 리다이렉트 | 없음 | [PNG](captures/public-1440-register-audit-unknown.png) |
| `/register/client` | public | 1440 | `/register/client` | 렌더 표본 | 없음 | [PNG](captures/public-1440-register-client.png) |
| `/register/counselor` | public | 1440 | `/register/counselor` | 렌더 표본 | 없음 | [PNG](captures/public-1440-register-counselor.png) |
| `/register/organization` | public | 1440 | `/register/organization` | 렌더 표본 | 없음 | [PNG](captures/public-1440-register-organization.png) |
| `/register` | public | 1440 | `/register` | 렌더 표본 | 없음 | [PNG](captures/public-1440-register.png) |
| `/report-view?token=synthetic-view-token` | public | 1440 | `/report-view` | 렌더 표본 | 없음 | [PNG](captures/public-1440-report-view-token-synthetic-view-token.png) |
| `/report-view` | public | 1440 | `/report-view` | 토큰 미제공 안내 | 없음 | [PNG](captures/public-1440-report-view.png) |
| `/reports/sample` | public | 1440 | `/reports/sample` | 렌더 표본 | 없음 | [PNG](captures/public-1440-reports-sample.png) |
| `/reset-password?token=synthetic-token` | public | 1440 | `/reset-password` | 렌더 표본 | 없음 | [PNG](captures/public-1440-reset-password-token-synthetic-token.png) |
| `/reset-password` | public | 1440 | `/reset-password` | 렌더 표본 | 없음 | [PNG](captures/public-1440-reset-password.png) |
| `/role-redirect` | public | 1440 | `/login` | 리다이렉트 | 없음 | [PNG](captures/public-1440-role-redirect.png) |
| `/set-password?token=synthetic-token` | public | 1440 | `/set-password` | 렌더 표본 | 없음 | [PNG](captures/public-1440-set-password-token-synthetic-token.png) |
| `/set-password` | public | 1440 | `/set-password` | 렌더 표본 | 없음 | [PNG](captures/public-1440-set-password.png) |
| `/terms` | public | 1440 | `/terms` | 렌더 표본 | 없음 | [PNG](captures/public-1440-terms.png) |
| `/account-deletion` | public | 390 | `/account-deletion` | 렌더 표본 | 없음 | [PNG](captures/public-390-account-deletion.png) |
| `*` | public | 390 | `/audit-unknown` | 의도된 404 | 없음 | [PNG](captures/public-390-audit-unknown.png) |
| `/class-members/:classId` | public | 390 | `/class-members/sample-class` | 렌더 표본 | 없음 | [PNG](captures/public-390-class-members-sample-class.png) |
| `/class/:sessionId/enter` | public | 390 | `/class/sample-session/enter` | 렌더 표본 | 없음 | [PNG](captures/public-390-class-sample-session-enter.png) |
| `/crisis-help` | public | 390 | `/crisis-help` | 렌더 표본 | 없음 | [PNG](captures/public-390-crisis-help.png) |
| `/forgot-password` | public | 390 | `/forgot-password` | 렌더 표본 | 없음 | [PNG](captures/public-390-forgot-password.png) |
| `/invite/:token` | public | 390 | `/invite/sample-token` | 렌더 표본 | 없음 | [PNG](captures/public-390-invite-sample-token.png) |
| `/join` | public | 390 | `/join` | 렌더 표본 | 없음 | [PNG](captures/public-390-join.png) |
| `/` | public | 390 | `/` | 렌더 표본 | 없음 | [PNG](captures/public-390-landing.png) |
| `/login/client` | public | 390 | `/login` | 리다이렉트 | 없음 | [PNG](captures/public-390-login-client.png) |
| `/login` | public | 390 | `/login` | 렌더 표본 | 없음 | [PNG](captures/public-390-login.png) |
| `/measurement-guide` | public | 390 | `/measurement-guide` | 렌더 표본 | 없음 | [PNG](captures/public-390-measurement-guide.png) |
| `/o/:org_code` | public | 390 | `/o/SAMPLE` | 렌더 표본 | 없음 | [PNG](captures/public-390-o-SAMPLE.png) |
| `/org/register` | public | 390 | `/register/organization` | 리다이렉트 | 없음 | [PNG](captures/public-390-org-register.png) |
| `/privacy` | public | 390 | `/privacy` | 렌더 표본 | 없음 | [PNG](captures/public-390-privacy.png) |
| `/register/*` | public | 390 | `/register` | 리다이렉트 | 없음 | [PNG](captures/public-390-register-audit-unknown.png) |
| `/register/client` | public | 390 | `/register/client` | 렌더 표본 | 없음 | [PNG](captures/public-390-register-client.png) |
| `/register/counselor` | public | 390 | `/register/counselor` | 렌더 표본 | 없음 | [PNG](captures/public-390-register-counselor.png) |
| `/register/organization` | public | 390 | `/register/organization` | 렌더 표본 | 없음 | [PNG](captures/public-390-register-organization.png) |
| `/register` | public | 390 | `/register` | 렌더 표본 | 없음 | [PNG](captures/public-390-register.png) |
| `/report-view?token=synthetic-view-token` | public | 390 | `/report-view` | 렌더 표본 | 없음 | [PNG](captures/public-390-report-view-token-synthetic-view-token.png) |
| `/report-view` | public | 390 | `/report-view` | 토큰 미제공 안내 | 없음 | [PNG](captures/public-390-report-view.png) |
| `/reports/sample` | public | 390 | `/reports/sample` | 렌더 표본 | 없음 | [PNG](captures/public-390-reports-sample.png) |
| `/reset-password?token=synthetic-token` | public | 390 | `/reset-password` | 렌더 표본 | 없음 | [PNG](captures/public-390-reset-password-token-synthetic-token.png) |
| `/reset-password` | public | 390 | `/reset-password` | 렌더 표본 | 없음 | [PNG](captures/public-390-reset-password.png) |
| `/role-redirect` | public | 390 | `/login` | 리다이렉트 | 없음 | [PNG](captures/public-390-role-redirect.png) |
| `/set-password?token=synthetic-token` | public | 390 | `/set-password` | 렌더 표본 | 없음 | [PNG](captures/public-390-set-password-token-synthetic-token.png) |
| `/set-password` | public | 390 | `/set-password` | 렌더 표본 | 없음 | [PNG](captures/public-390-set-password.png) |
| `/terms` | public | 390 | `/terms` | 렌더 표본 | 없음 | [PNG](captures/public-390-terms.png) |
