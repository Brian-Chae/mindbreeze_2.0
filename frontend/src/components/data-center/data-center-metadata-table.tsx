import { formatCount, type Count } from "../../lib/api/data-center";
export interface InventoryItem {
  kind: string;
  label: string;
  storage_category: string;
  retention_policy: string;
  count: Count;
  exportable: boolean;
}
export interface ConsentItem {
  scope: string;
  subject_ref: string;
  notice_version: string | null;
  state: string;
  at: string | null;
  export_state: string | null;
}
export interface ResearchBatchItem {
  batch_id: string;
  status: string;
  created_at: string;
  file_count: number;
  total_bytes: number;
  acked_at: string | null;
}
export interface RetentionRunItem {
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}
export interface RetentionCandidate {
  kind: string;
  ref: string;
  deadline: string | null;
  reason: string;
}
export interface AccountDeletionItem {
  source: string;
  ref: string;
  status: string;
  received_at: string | null;
  grace_until: string | null;
}
export interface BaselineItem {
  baseline_id: number;
  pipeline_version: string | null;
  is_active: boolean;
  created_at: string;
}
export type MetadataItem =
  | InventoryItem
  | ConsentItem
  | ResearchBatchItem
  | RetentionRunItem
  | RetentionCandidate
  | AccountDeletionItem
  | BaselineItem;
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR") : "미확인";
const labels: Record<string, string> = {
  agreed: "동의",
  withdrawn: "철회",
  none: "미동의",
  collection: "수집 동의",
  research: "연구 동의",
  due: "기한 도래",
  near_due: "기한 임박",
  research_hold: "연구 보류",
  unknown_deadline: "기한 미확인",
};
// eslint-disable-next-line react-refresh/only-export-components
export function metadataProjection(item: MetadataItem): {
  key: string;
  cells: string[];
} {
  if ("storage_category" in item)
    return {
      key: item.kind,
      cells: [
        item.label,
        `${item.storage_category} · ${item.retention_policy}`,
        formatCount(item.count),
        item.exportable ? "반출 가능" : "반출 제외",
      ],
    };
  if ("subject_ref" in item)
    return {
      key: `${item.subject_ref}-${item.scope}-${item.at}`,
      cells: [
        item.subject_ref,
        `${labels[item.scope] || item.scope} · ${item.notice_version || "고지 미확인"}`,
        labels[item.state] || item.state,
        `${item.export_state || "반출 이력 없음"} · ${date(item.at)}`,
      ],
    };
  if ("batch_id" in item)
    return {
      key: item.batch_id,
      cells: [
        item.batch_id,
        item.status,
        `${item.file_count}개 파일 · ${item.total_bytes.toLocaleString()} B`,
        item.acked_at ? `수신 확인 ${date(item.acked_at)}` : "수신 확인 전",
      ],
    };
  if ("run_id" in item)
    return {
      key: item.run_id,
      cells: [
        item.run_id,
        item.mode === "dry_run" ? "사전 점검" : "실행 기록",
        item.status,
        `${date(item.started_at)} / ${date(item.finished_at)}`,
      ],
    };
  if ("deadline" in item)
    return {
      key: item.ref,
      cells: [
        item.ref,
        item.kind,
        labels[item.reason] || item.reason,
        date(item.deadline),
      ],
    };
  if ("source" in item)
    return {
      key: item.ref,
      cells: [
        item.ref,
        item.source === "request" ? "공개 접수" : "확정 탈퇴 원장",
        item.status,
        `접수 ${date(item.received_at)} · 유예 ${date(item.grace_until)}`,
      ],
    };
  return {
    key: String(item.baseline_id),
    cells: [
      `기준 측정 ${item.baseline_id}`,
      item.pipeline_version || "버전 미확인",
      item.is_active ? "활성" : "이전",
      date(item.created_at),
    ],
  };
}
export function MetadataTable({ items }: { items: MetadataItem[] }) {
  return (
    <div className="dc-table-wrap">
      <table>
        <thead>
          <tr>
            {["항목", "유형 · 정책", "현황", "처리 · 시각"].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const row = metadataProjection(item);
            return (
              <tr key={row.key}>
                {row.cells.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
