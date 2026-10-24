"""SQLAlchemy Models — All"""

from app.models.user import User
from app.models.session import Session, SessionParticipant, SessionReminderLog, ReportChoiceEvent
from app.models.record import SessionRecord, EEGRecord, EEGRawChunk, Report, AudioChunk, VideoChunk
from app.models.eeg_feature import EEGFeatureWindow
from app.models.credential import Credential, VerificationAudit
from app.models.notification import Notification
from app.models.notification_outbox import NotificationOutbox
from app.models.pipeline_outbox import PipelineOutbox
from app.models.refresh_token import RefreshToken
from app.models.consent import Consent
from app.models.onboarding_progress import OnboardingProgress
from app.models.client_counselor_link import ClientCounselorLink
from app.models.password_history import PasswordHistory
from app.models.counselor_profile import CounselorProfile
from app.models.client_profile import ClientProfile
from app.models.organization import Organization
from app.models.org_join_request import OrganizationJoinRequest
from app.models.user_org_membership import UserOrgMembership
from app.models.client_invite import ClientInvite
from app.models.chat import ChatRoom, ChatMessage, ChatMessageRead, ChatRoomParticipant, ChatReport, ChatBlock
from app.models.org_document import OrgDocument
from app.models.qualification import Qualification
from app.models.career import Career
from app.models.signup_application import SignupApplication
from app.models.agent import (
    AgentConversation,
    AgentMessage,
    AgentRelayEvent,
    AgentDeliveryLog,
    AgentCounselorSettings,
    AgentBriefingLog,
    AgentCheckinEnablement,
    AgentCheckinPref,
    AgentCheckin,
    AgentProfileItem,
    AgentRiskSignal,
)

from app.models.normalization_baseline import NormalizationBaseline
from app.models.normalization_model import NormalizationModel
from app.models.narrative_cache import NarrativeCache
from app.models.original_deletion_audit import OriginalDeletionAudit
from app.models.class_program import Class, ClassInstructor, ClassMember, ClassMemberEvent
from app.models.counseling import (
    CounselingGuest,
    CounselingRelationship,
    CounselingRelationshipCounselor,
    CounselingRelationshipEvent,
    GuestClaimEvent,
)
from app.models.session_parent import SessionHostHistory
# SDD-220: 소셜 연결·탈퇴 원장·소셜 해제 outbox·공개 삭제 요청 (감독자 등록 요청 전에도 메타데이터 일치 테스트가 통과하도록 최소 1줄)
from app.models.account_deletion import (
    AccountDeletionLedger,
    AccountDeletionObject,
    AccountDeletionRequest,
    SocialIdentity,
    SocialRevokeOutbox,
)

__all__ = [
    "Class",
    "ClassInstructor",
    "ClassMember",
    "ClassMemberEvent",
    "CounselingGuest",
    "CounselingRelationship",
    "CounselingRelationshipCounselor",
    "CounselingRelationshipEvent",
    "GuestClaimEvent",
    "SessionHostHistory",
    "ReportChoiceEvent",
    "OriginalDeletionAudit",
    "NormalizationBaseline",
    "NormalizationModel",
    "NarrativeCache",
    "ChatRoom",
    "ChatMessage",
    "ChatMessageRead",
    "ChatRoomParticipant",
    "ChatReport",
    "ChatBlock",
    "User",
    "Session",
    "SessionParticipant",
    "SessionReminderLog",
    "SessionRecord",
    "EEGRecord",
    "EEGRawChunk",
    "EEGFeatureWindow",
    "Report",
    "AudioChunk",
    "VideoChunk",
    "Credential",
    "VerificationAudit",
    "Notification",
    "NotificationOutbox",
    "PipelineOutbox",
    "RefreshToken",
    "Consent",
    "OnboardingProgress",
    "ClientCounselorLink",
    "PasswordHistory",
    "CounselorProfile",
    "ClientProfile",
    "Organization",
    "OrganizationJoinRequest",
    "UserOrgMembership",
    "ClientInvite",
    "OrgDocument",
    "Qualification",
    "Career",
    "SignupApplication",
    # SDD-188: AI 에이전트 양방향 채널
    "AgentConversation",
    "AgentMessage",
    "AgentRelayEvent",
    "AgentDeliveryLog",
    "AgentCounselorSettings",
    "AgentBriefingLog",
    "AgentCheckinEnablement",
    "AgentCheckinPref",
    "AgentCheckin",
    "AgentProfileItem",
    "AgentRiskSignal",
]

from app.models.data_export import DataExportJob, DataExportAudit
__all__ += ["DataExportJob", "DataExportAudit"]

# SDD-190: 앱 푸시 디바이스 토큰
from app.models.device_token import DeviceToken
__all__ += ["DeviceToken"]

# SDD-209 B11: 연구 목적 데이터 활용 동의
from app.models.research import ResearchConsent, ResearchConsentEvent, ResearchWithdrawalRequest
__all__ += ["ResearchConsent", "ResearchConsentEvent", "ResearchWithdrawalRequest"]

# SDD-209 B14: 비회원 이메일 초대
from app.models.session_email_invite import SessionEmailInvite
__all__ += ["SessionEmailInvite"]

# SDD-209 B12: 기본 DB 삭제 스위프 실행 이력
from app.models.retention_sweep_run import RetentionSweepRun
__all__ += ["RetentionSweepRun"]

# SDD-209 B13: 연구 DB 내보내기 배치
from app.models.research_export import ResearchExportBatch, ResearchExportItem, ResearchSignalReceipt, ObjectDeletionOutbox
__all__ += ["ResearchExportBatch", "ResearchExportItem", "ResearchSignalReceipt", "ObjectDeletionOutbox"]

# SDD-216: 편성 트랜잭션과 진행자 요청
from app.models.class_scheduling import ClassOperation, ClassEffect, ClassEmailInvite, SessionHostRequest, SessionHostNote
__all__ += ["ClassOperation", "ClassEffect", "ClassEmailInvite", "SessionHostRequest", "SessionHostNote"]

# SDD-217: 클래스 멤버십·보강·guest 자격·동의·현재 참여
from app.models.class_membership import (
    ClassAttendanceEvent, ClassMakeupAssignment, ClassGuestCredential, ClassGuestRecovery,
    ClassGuestMerge, ClassMemberOperation, ClassGuestJoinOperation,
    ClassMemberConsentEvent, SessionPresenceLease,
)
__all__ += [
    'ClassAttendanceEvent', 'ClassMakeupAssignment', 'ClassGuestCredential', 'ClassGuestRecovery',
    'ClassGuestMerge', 'ClassMemberOperation', 'ClassGuestJoinOperation',
    'ClassMemberConsentEvent', 'SessionPresenceLease',
]

from app.models.class_report_job import ClassReportJob, ClassReportJobItem
__all__ += ['ClassReportJob', 'ClassReportJobItem']

# SDD-244 M1: 생체신호 stream/segment/gap/종료 의도/manifest revision
from app.models.biosignal import (
    BiosignalStream, BiosignalSegment, BiosignalGapEvent, BiosignalCloseIntent,
    BiosignalManifestRevision, BiosignalManifestCurrent, BiosignalArtifact, BiosignalFeatureAlias,
    DisplaySnapshot, NormalizationSnapshotRow,
)
__all__ += [
    "BiosignalStream", "BiosignalSegment", "BiosignalGapEvent", "BiosignalCloseIntent",
    "BiosignalManifestRevision", "BiosignalManifestCurrent", "BiosignalArtifact", "BiosignalFeatureAlias",
    "DisplaySnapshot", "NormalizationSnapshotRow",
]
