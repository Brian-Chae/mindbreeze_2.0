import { apiClient, ApiError } from './client';
import type { ClassSummaryResponse, ClassReportResponse, NarrativePatchRequest, NarrativePatchResponse } from '../class-report/types';
import { getMockState, getMockSummary, getMockReport } from '../class-report/mocks';
const path = (id: string) => `/sessions/${encodeURIComponent(id)}`;
const reports = new Map<string, ClassReportResponse>();
const seen = new Set<string>();
let noteEnabled = true;
export const classSummaryApi = {
  async summary(id: string): Promise<ClassSummaryResponse> {
    const state = getMockState();
    if (!state) return apiClient.get<ClassSummaryResponse>(`${path(id)}/class-summary`);
    const result = getMockSummary(state);
    result.session = { ...result.session, id };
    const field = reports.get(`${id}:${state}`)?.block?.narrative.fields.headline;
    if (field) result.class_report.headline = { text: field.text, source: field.source, edited_by_name: field.edited_by_name, edited_at: field.edited_at };
    result.note_prompt = { ...result.note_prompt, user_enabled: noteEnabled, seen: seen.has(id), eligible: noteEnabled && !seen.has(id) };
    return result;
  },
  async report(id: string): Promise<ClassReportResponse> {
    const state = getMockState();
    if (!state) return apiClient.get<ClassReportResponse>(`${path(id)}/class-report`);
    const key = `${id}:${state}`;
    if (!reports.has(key)) reports.set(key, getMockReport(state));
    const result = structuredClone(reports.get(key)!);
    return { ...result, session: { ...result.session, id } };
  },
  async patchNarrative(id: string, request: NarrativePatchRequest): Promise<NarrativePatchResponse> {
    if (!getMockState()) return apiClient.patch<NarrativePatchResponse>(`${path(id)}/class-report/narrative`, request);
    const report = await this.report(id);
    const field = report.block?.narrative.fields[request.field];
    if (!field) throw new ApiError(409, 'report_not_ready', null);
    if (!report.capabilities.can_edit_narrative) throw new ApiError(403, 'narrative_edit_forbidden', null);
    if (!request.revert && request.base_edited_at !== field.edited_at) throw new ApiError(409, 'edit_conflict', { value: field });
    const text = request.revert ? null : request.text.trim();
    if (!request.revert && !text) throw new ApiError(422, 'empty_text', null);
    if (text && (text.length > field.max_len || Array.from(text).some((character) => character.charCodeAt(0) < 32))) throw new ApiError(422, 'text_too_long', null);
    const now = new Date().toISOString();
    const value = request.revert ? { ...field, text: field.ai_draft ?? field.rule_text, source: field.ai_draft ? 'ai' as const : 'rule' as const, edited_text: null, edited_by: null, edited_by_name: null, edited_at: null, stale: false } : { ...field, text: text!, source: 'edited' as const, edited_text: text!, edited_by: 'u_1', edited_by_name: '채 코치', edited_at: now, stale: false };
    if (report.block) report.block = { ...report.block, narrative: { ...report.block.narrative, fields: { ...report.block.narrative.fields, [request.field]: value } } };
    reports.set(`${id}:${getMockState()}`, report);
    return { field: request.field, value, fetched_at: now };
  },
  async claimNotePrompt(id: string): Promise<{ show: boolean }> {
    if (!getMockState()) return apiClient.post<{ show: boolean }>(`${path(id)}/note-prompt/claim`, {});
    const show = noteEnabled && !seen.has(id); seen.add(id); return { show };
  },
  async dismissNotePrompt(id: string): Promise<{ dismissed_at: string }> {
    if (!getMockState()) return apiClient.post<{ dismissed_at: string }>(`${path(id)}/note-prompt/dismiss`, {});
    seen.add(id); return { dismissed_at: new Date().toISOString() };
  },
};
export const sessionNotePromptApi = {
  async get(): Promise<{ enabled: boolean }> {
    return getMockState() ? { enabled: noteEnabled } : apiClient.get<{ enabled: boolean }>('/users/me/session-note-prompt');
  },
  async set(enabled: boolean): Promise<{ enabled: boolean }> {
    if (!getMockState()) return apiClient.patch<{ enabled: boolean }>('/users/me/session-note-prompt', { enabled });
    noteEnabled = enabled; return { enabled };
  },
};
