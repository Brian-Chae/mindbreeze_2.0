import { apiClient } from "./client";
export interface Count {
  value: number | null;
  partial: boolean;
  unavailable_reason?: string | null;
}
export interface DataCenterPage<T> {
  items: T[];
  next_cursor: string | null;
  total: number | null;
  as_of: string;
  total_reason?: string | null;
}
export interface DataCenterContext {
  role: string;
  current_org: { id: string; name: string } | null;
  allowed_orgs: { id: string; name: string }[];
  default_org_id: string | null;
  capabilities: {
    enabled: boolean;
    tabs: string[];
    can_reveal_contact: boolean;
    can_research: boolean;
    can_export_identified: boolean;
  };
  limits: { member_facilitator_max_sessions: number; provisional: boolean; reauth_required?: boolean; artifact_ttl_seconds?: number; url_ttl_seconds?: number };
}
export interface ClassItem {
  class_id: string;
  title: string;
  org_name: string;
  status: string;
  ended_session_count: Count;
  stored_bytes: Count;
  facilitator_aliases: string[];
}
export interface SessionItem {
  session_id: string;
  title: string;
  seq: number;
  status: string;
  started_at: string | null;
  participant_count: Count;
  measured_count: Count;
  exportable: boolean;
  exclusion_reason: string | null;
}
export interface ParticipantItem {
  participant_id: string;
  alias: string;
  display_name: string | null;
  band_used: boolean;
  measurement: string;
  selectable: boolean;
  unselectable_reason: string | null;
}
export interface SubjectItem {
  subject_id: string;
  subject_type: string;
  display_name: string;
  email: string | null;
  role: string;
  status: string;
  org_names: string[];
  holdings: { sessions: Count; measurements: Count };
  contact_on_file: boolean;
}
export interface Summary {
  scope_label: string;
  as_of: string;
  kpis: { key: string; label: string; unit: string; count: Count }[];
}
export const dataCenterTabs = [
  { key: "overview", label: "개요" },
  { key: "subjects", label: "사용자 데이터" },
  { key: "classes", label: "클래스 데이터" },
  { key: "consents", label: "동의·연구" },
  { key: "retention", label: "보관·삭제" },
  { key: "standard", label: "표준 데이터" },
  { key: "jobs", label: "다운로드 작업" },
  { key: "audits", label: "다운로드 기록" },
];
export function visibleDataCenterTabs(
  context: Pick<DataCenterContext, "role" | "capabilities">,
) {
  return dataCenterTabs.filter(
    (t) =>
      context.capabilities.tabs.includes(t.key) &&
      (context.role === "platform_admin" ||
        !["consents", "retention", "standard"].includes(t.key)),
  );
}
export function formatCount(count: Count) {
  return count.value === null
    ? count.unavailable_reason || "미집계"
    : `${count.partial ? "약 " : ""}${count.value.toLocaleString("ko-KR")}`;
}
export function dataCenterGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return apiClient.get<T>(
    `/data-center${path}${query.size ? "?" + query : ""}`,
    { signal },
  );
}
export function revealDataCenterContact(subject: SubjectItem, orgId?: string) {
  return apiClient.post<{ phone: string | null; birth_date: string | null }>(
    `/data-center/subjects/${subject.subject_type}/${subject.subject_id}/contact-reveal${orgId ? "?org_id=" + encodeURIComponent(orgId) : ""}`,
    { fields: ["phone", "birth_date"] },
  );
}
