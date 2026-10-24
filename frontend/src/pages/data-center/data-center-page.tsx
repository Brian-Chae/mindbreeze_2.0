import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  MetadataTable,
  type MetadataItem,
  type InventoryItem,
} from "../../components/data-center/data-center-metadata-table";
import { MeasurementDetail } from "../../components/data-center/measurement-detail";
import AppShell from "../../components/layout/AppShell";
import { useDataCenter } from "../../hooks/use-data-center";
import {
  formatCount,
  visibleDataCenterTabs,
  revealDataCenterContact,
} from "../../lib/api/data-center";
import type {
  ClassItem,
  DataCenterContext,
  DataCenterPage as Page,
  ParticipantItem,
  SessionItem,
  SubjectItem,
  Summary,
} from "../../lib/api/data-center";
import "./data-center.css";
export interface DataCenterSelection {
  scope: "class" | "session" | "member" | "facilitator";
  id: string;
  label: string;
  sessionIds?: string[];
  subjectType?: string;
}
export interface DataCenterPageProps {
  renderMeasurement?: (
    sessionId: string,
    participantId: string,
    orgId?: string,
    onClose?: () => void,
  ) => ReactNode;
  renderExports?: (
    context: DataCenterContext,
    selection: DataCenterSelection | null,
    tab: string,
    onClose: () => void,
  ) => ReactNode;
}
export default function DataCenterPage(props: DataCenterPageProps) {
  const [orgId, setOrgId] = useState<string>();
  const context = useDataCenter<DataCenterContext>("/contexts", {
    org_id: orgId,
  });
  if (!context.data)
    return (
      <AppShell title="데이터 센터">
        <div className="dc">
          <h1>데이터 센터</h1>
          <p role="status">
            {context.error || "허용된 데이터 범위를 확인하고 있습니다…"}
          </p>
        </div>
      </AppShell>
    );
  return (
    <AppShell title="데이터 센터">
      <DataCenterWorkspace
        key={orgId || context.data.current_org?.id || "platform"}
        context={context.data}
        orgId={orgId || context.data.current_org?.id}
        onOrgChange={setOrgId}
        {...props}
      />
    </AppShell>
  );
}
export function DataCenterWorkspace({
  context,
  orgId,
  onOrgChange,
  renderMeasurement,
  renderExports,
}: DataCenterPageProps & {
  context: DataCenterContext;
  orgId?: string;
  onOrgChange?: (id: string) => void;
}) {
  const [tab, setTab] = useState("classes");
  const [subtab, setSubtab] = useState("");
  const [mode, setMode] = useState("classes");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const [classItem, setClass] = useState<ClassItem | null>(null);
  const [session, setSession] = useState<SessionItem | null>(null);
  const [subject, setSubject] = useState<SubjectItem | null>(null);
  const [measurement, setMeasurement] = useState<string | null>(null);
  const [contact, setContact] = useState<{
    phone: string | null;
    birth_date: string | null;
  } | null>(null);
  const [revealError, setRevealError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportSelection, setExportSelection] =
    useState<DataCenterSelection | null>(null);
  const revealGeneration = useRef(0);
  useEffect(
    () => () => {
      revealGeneration.current += 1;
    },
    [],
  );
  const summary = useDataCenter<Summary>(
    context.capabilities.enabled ? "/summary" : null,
    { org_id: orgId },
  );
  function discardSensitive() {
    revealGeneration.current += 1;
    setContact(null);
    setMeasurement(null);
    setExportSelection(null);
  }
  const params = {
    org_id: orgId,
    q,
    status,
    cursor,
    date_from: dateFrom,
    date_to: dateTo,
  };
  const path =
    tab === "overview"
      ? "/inventory"
      : tab === "subjects" ||
          (tab === "classes" && mode !== "classes" && !subject)
        ? "/subjects"
        : tab === "classes"
          ? subject
            ? mode === "facilitator" && (!dateFrom || !dateTo)
              ? null
              : `/${mode === "facilitator" ? "facilitators" : "members"}/${subject.subject_id}/sessions`
            : session
              ? `/sessions/${session.session_id}/participants`
              : classItem
                ? `/classes/${classItem.class_id}/sessions`
                : "/classes"
          : tab === "consents"
            ? subtab === "batches"
              ? "/research-batches"
              : "/consents"
            : tab === "retention"
              ? subtab === "candidates"
                ? "/retention-candidates"
                : subtab === "deletions"
                  ? "/account-deletions"
                  : "/retention-runs"
              : tab === "standard"
                ? "/baselines"
                : null;
  const query = useDataCenter<
    | { items: InventoryItem[]; as_of: string }
    | Page<
        MetadataItem | ClassItem | SubjectItem | SessionItem | ParticipantItem
      >
    | { sessions: Page<SessionItem>; participants?: Page<ParticipantItem> }
  >(context.capabilities.enabled ? path : null, {
    ...params,
    role:
      tab === "classes" && mode !== "classes"
        ? mode === "facilitator"
          ? "counselor"
          : "client"
        : undefined,
    subject_type: subject?.subject_type,
  });
  function reset() {
    discardSensitive();
    setClass(null);
    setSession(null);
    setSubject(null);
    setMeasurement(null);
    setContact(null);
    setRevealError("");
    setCursor(undefined);
    setExportSelection(null);
  }
  function changeTab(next: string) {
    reset();
    setTab(next);
    setSubtab("");
    setQ("");
    setStatus("");
  }
  const data = query.data;
  const page =
    data && "items" in data
      ? { total: data.items.length, next_cursor: null, ...data }
      : data && "participants" in data && data.participants
        ? data.participants
        : data && "sessions" in data
          ? data.sessions
          : null;
  let rows = page?.items || [];
  const rowGroup = (item: (typeof rows)[number]) =>
    "org_names" in item
      ? item.org_names.join(", ") || "기관 미확인"
      : "org_name" in item
        ? item.org_name
        : "status" in item
          ? item.status
          : "measurement" in item
            ? item.band_used
              ? "밴드 사용"
              : "밴드 미사용"
            : "데이터";
  if (group)
    rows = [...rows].sort((a, b) =>
      rowGroup(a).localeCompare(rowGroup(b), "ko"),
    );
  let previousGroup: string | null = null;
  function exportTarget() {
    if (subject)
      return {
        scope: mode === "facilitator" ? "facilitator" : "member",
        id: subject.subject_id,
        label: subject.display_name,
        subjectType: subject.subject_type,
      } as DataCenterSelection;
    if (session)
      return {
        scope: "session",
        id: session.session_id,
        label: session.title,
      } as DataCenterSelection;
    if (classItem)
      return {
        scope: "class",
        id: classItem.class_id,
        label: classItem.title,
      } as DataCenterSelection;
    return null;
  }
  return (
    <main className="dc">
      <header className="dc-heading">
        <div>
          <div className="dc-eyebrow">
            {context.role === "platform_admin"
              ? "플랫폼 관리자"
              : "기관 관리자"}{" "}
            · DATA CENTER
          </div>
          <h1>
            {context.role === "org_admin"
              ? `${context.current_org?.name || "현재 기관"} 데이터 센터`
              : "데이터 센터"}
          </h1>
          <p>보유 현황을 확인하고, 필요한 회차의 원천 데이터를 탐색합니다.</p>
        </div>
        <span className="dc-badge">권한 범위 내 조회</span>
      </header>
      {context.allowed_orgs.length > 1 && (
        <label>
          조회 기관
          <select
            aria-label="조회 기관"
            value={orgId || ""}
            onChange={(e) => onOrgChange?.(e.target.value)}
          >
            {context.role === "platform_admin" && (
              <option value="">전체 기관</option>
            )}
            {context.allowed_orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {summary.data && (
        <div className="dc-kpis">
          {summary.data.kpis.map((k) => (
            <article key={k.key}>
              <span>{k.label}</span>
              <strong>
                {formatCount(k.count)}{" "}
                <small>{k.count.value === null ? "" : k.unit}</small>
              </strong>
            </article>
          ))}
        </div>
      )}
      <nav className="dc-tabs" aria-label="데이터 센터 탭">
        {visibleDataCenterTabs(context).map((t) => (
          <button
            key={t.key}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {!context.capabilities.enabled ? (
        <div className="dc-notice">
          현재 기관의 데이터 센터가 활성화되지 않았습니다.
        </div>
      ) : (
        <>
          <section className="dc-panel">
            <div className="dc-section-heading">
              <div>
                <h2>
                  {tab === "classes"
                    ? "클래스에서 회차로, 회차에서 참여자로"
                    : visibleDataCenterTabs(context).find((t) => t.key === tab)
                        ?.label}
                </h2>
                <p>
                  밴드 미사용과 미수집을 구분하며, 없는 값을 0으로 표시하지
                  않습니다.
                </p>
              </div>
              {exportTarget() && (
                <button
                  className="dc-primary"
                  onClick={() => setExportSelection(exportTarget())}
                >
                  다운로드 설정
                </button>
              )}
            </div>
            {tab === "classes" && (
              <div className="dc-subtabs">
                {[
                  ["classes", "클래스 탐색"],
                  ["member", "회원 단위"],
                  ["facilitator", "상담사 단위"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={mode === key}
                    onClick={() => {
                      reset();
                      setMode(key);
                      setQ("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {(tab === "consents" || tab === "retention") && (
              <div className="dc-subtabs">
                {(tab === "consents"
                  ? [
                      ["", "수집·연구 동의"],
                      ["batches", "연구 배치"],
                    ]
                  : [
                      ["", "실행 기록"],
                      ["candidates", "삭제 후보"],
                      ["deletions", "계정 삭제 접수·원장"],
                    ]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={subtab === key}
                    onClick={() => {
                      discardSensitive();
                      setSubtab(key);
                      setCursor(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!["jobs", "audits"].includes(tab) && (
              <div className="dc-filters">
                <label>
                  검색
                  <input
                    aria-label="데이터 검색"
                    value={q}
                    placeholder="이름·클래스·이메일 검색"
                    onChange={(e) => {
                      discardSensitive();
                      setQ(e.target.value);
                      setCursor(undefined);
                      setContact(null);
                      setMeasurement(null);
                    }}
                  />
                </label>
                <label>
                  상태
                  <select
                    aria-label="상태 필터"
                    value={status}
                    onChange={(e) => {
                      discardSensitive();
                      setStatus(e.target.value);
                      setCursor(undefined);
                      setContact(null);
                      setMeasurement(null);
                    }}
                  >
                    <option value="">상태 전체</option>
                    <option value="active">활성</option>
                    <option value="completed">종료</option>
                    <option value="cancelled">취소</option>
                  </select>
                </label>
                <label>
                  보기
                  <select
                    aria-label="그룹 보기"
                    value={group ? "group" : "list"}
                    onChange={(e) => {
                      discardSensitive();
                      setGroup(e.target.value === "group");
                    }}
                  >
                    <option value="list">기본 목록</option>
                    <option value="group">기관·상태별 그룹</option>
                  </select>
                </label>
              </div>
            )}
            {mode !== "classes" && tab === "classes" && (
              <div className="dc-filters">
                <label>
                  시작일
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      discardSensitive();
                      setDateFrom(e.target.value);
                      setCursor(undefined);
                      setMeasurement(null);
                      setContact(null);
                    }}
                  />
                </label>
                <label>
                  종료일
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      discardSensitive();
                      setDateTo(e.target.value);
                      setCursor(undefined);
                      setMeasurement(null);
                      setContact(null);
                    }}
                  />
                </label>
                <p>
                  회원·상담사 반출은 요청당 최대{" "}
                  {context.limits.member_facilitator_max_sessions}회차 · 상담사
                  기간 필수
                </p>
              </div>
            )}
            {(classItem || subject) && (
              <div className="dc-breadcrumb">
                <button onClick={reset}>
                  {mode === "classes" ? "클래스" : "사용자"} 목록
                </button>
                <span>› {classItem?.title || subject?.display_name}</span>
                {session && (
                  <>
                    <button
                      onClick={() => {
                        setSession(null);
                        setMeasurement(null);
                        setCursor(undefined);
                      }}
                    >
                      회차 목록
                    </button>
                    <span>› {session.seq}회차</span>
                  </>
                )}
              </div>
            )}
            {measurement && session ? (
              renderMeasurement?.(session.session_id, measurement, orgId, () =>
                setMeasurement(null),
              ) ?? <MeasurementDetail sessionId={session.session_id} participantId={measurement} orgId={orgId} onClose={()=>setMeasurement(null)} />
            ) : (
              <>
                {query.loading && <p role="status">불러오는 중…</p>}
                {query.error && <p role="alert">{query.error}</p>}
                {page && (
                  <>
                    <div className="dc-result">
                      {page.total === null
                        ? "전체 건수 미집계"
                        : `${page.total}개 항목`}{" "}
                      · 조회 기준 {new Date(page.as_of).toLocaleString("ko-KR")}
                    </div>
                    {["overview", "consents", "retention", "standard"].includes(
                      tab,
                    ) ? (
                      <MetadataTable items={rows as MetadataItem[]} />
                    ) : (
                      <div className="dc-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>항목 / 이름</th>
                              <th>기관 · 상태</th>
                              <th>보유 현황</th>
                              <th>탐색</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.flatMap((item) => {
                              const heading =
                                group && previousGroup !== rowGroup(item) ? (
                                  <tr
                                    key={"group-" + rowGroup(item)}
                                    className="dc-group-row"
                                  >
                                    <td colSpan={4}>{rowGroup(item)}</td>
                                  </tr>
                                ) : null;
                              previousGroup = rowGroup(item);
                              const row = (() => {
                                if (
                                  "class_id" in item &&
                                  "ended_session_count" in item
                                )
                                  return (
                                    <tr key={item.class_id}>
                                      <td>
                                        <strong>{item.title}</strong>
                                        <small>
                                          진행자{" "}
                                          {item.facilitator_aliases.join(
                                            ", ",
                                          ) || "미확인"}
                                        </small>
                                      </td>
                                      <td>
                                        {item.org_name}
                                        <small>{item.status}</small>
                                      </td>
                                      <td>
                                        {formatCount(item.ended_session_count)}
                                        회차
                                        <small>
                                          저장량{" "}
                                          {formatCount(item.stored_bytes)}
                                        </small>
                                      </td>
                                      <td>
                                        <button
                                          onClick={() => {
                                            setClass(item);
                                            setCursor(undefined);
                                          }}
                                        >
                                          회차 보기 →
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                if ("subject_id" in item && "holdings" in item)
                                  return (
                                    <tr key={item.subject_id}>
                                      <td>
                                        <strong>{item.display_name}</strong>
                                        <small>
                                          {item.email || "이메일 수집 없음"}
                                        </small>
                                      </td>
                                      <td>
                                        {item.org_names.join(", ")}
                                        <small>
                                          {item.role === "counselor"
                                            ? "상담사"
                                            : "회원"}{" "}
                                          · {item.status}
                                        </small>
                                      </td>
                                      <td>
                                        {formatCount(item.holdings.sessions)}
                                        회차
                                        <small>
                                          측정{" "}
                                          {formatCount(
                                            item.holdings.measurements,
                                          )}
                                          건
                                        </small>
                                      </td>
                                      <td>
                                        <button
                                          onClick={() => {
                                            setSubject(item);
                                            setTab("classes");
                                            if (tab === "subjects")
                                              setMode(
                                                item.role === "counselor"
                                                  ? "facilitator"
                                                  : "member",
                                              );
                                            setContact(null);
                                            setCursor(undefined);
                                          }}
                                        >
                                          회차 보기 →
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                if ("session_id" in item)
                                  return (
                                    <tr key={item.session_id}>
                                      <td>
                                        <strong>
                                          {item.seq}회차 · {item.title}
                                        </strong>
                                        <small>
                                          {item.started_at
                                            ? new Date(
                                                item.started_at,
                                              ).toLocaleDateString("ko-KR")
                                            : "시각 미확인"}
                                        </small>
                                      </td>
                                      <td>
                                        {item.status === "completed"
                                          ? "종료"
                                          : item.status}
                                      </td>
                                      <td>
                                        참여{" "}
                                        {formatCount(item.participant_count)}명
                                        <small>
                                          측정{" "}
                                          {formatCount(item.measured_count)}건
                                        </small>
                                      </td>
                                      <td>
                                        <button
                                          onClick={() => {
                                            setSession(item);
                                            setSubject(null);
                                            setCursor(undefined);
                                          }}
                                        >
                                          참여자 보기 →
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                if ("participant_id" in item)
                                  return (
                                    <tr key={item.participant_id}>
                                      <td>
                                        <strong>
                                          {item.display_name || item.alias}
                                        </strong>
                                        <small>참여자</small>
                                      </td>
                                      <td>
                                        {item.band_used
                                          ? "밴드 사용"
                                          : "밴드 미사용"}
                                      </td>
                                      <td>
                                        {item.measurement === "available"
                                          ? "측정 보유"
                                          : item.band_used
                                            ? "미수집"
                                            : "정상 · 밴드 미사용"}
                                      </td>
                                      <td>
                                        <button
                                          onClick={() =>
                                            setMeasurement(item.participant_id)
                                          }
                                        >
                                          측정 상세 →
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                return null;
                              })();
                              return heading ? [heading, row] : [row];
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {!rows.length && (
                      <div className="dc-empty">
                        <h3>검색 조건에 맞는 데이터가 없습니다</h3>
                        <p>검색어 또는 상태 필터를 바꿔 확인하세요.</p>
                        <button
                          onClick={() => {
                            setQ("");
                            setStatus("");
                            setCursor(undefined);
                          }}
                        >
                          필터 초기화
                        </button>
                      </div>
                    )}
                    <div className="dc-pagination">
                      <button
                        disabled={!cursor}
                        onClick={() => {
                          discardSensitive();
                          setCursor(undefined);
                          setContact(null);
                        }}
                      >
                        첫 페이지
                      </button>
                      <button
                        disabled={!page.next_cursor}
                        onClick={() => {
                          discardSensitive();
                          setCursor(page.next_cursor || undefined);
                          setContact(null);
                          setMeasurement(null);
                        }}
                      >
                        다음 페이지 →
                      </button>
                    </div>
                  </>
                )}
                {mode === "facilitator" &&
                  subject &&
                  (!dateFrom || !dateTo) && (
                    <div className="dc-notice">
                      상담사 회차를 보려면 시작일과 종료일을 선택하세요.
                    </div>
                  )}
              </>
            )}
            {subject && context.capabilities.can_reveal_contact && (
              <aside className="dc-notice">
                <strong>{subject.display_name} 인적사항</strong>
                <p>
                  {contact
                    ? `연락처 ${contact.phone || "수집 없음"} · 생년월일 ${contact.birth_date || "수집 없음"}`
                    : "연락처 · 생년월일 마스킹"}
                </p>
                <button
                  onClick={() => {
                    if (contact) {
                      setContact(null);
                      return;
                    }
                    const generation = ++revealGeneration.current;
                    void revealDataCenterContact(subject, orgId)
                      .then((result) => {
                        if (revealGeneration.current === generation)
                          setContact(result);
                      })
                      .catch(() =>
                        setRevealError("열람 권한을 확인해 주세요."),
                      );
                  }}
                >
                  {contact ? "다시 가리기" : "개인정보 개별 열람"}
                </button>
                {revealError && <p role="alert">{revealError}</p>}
              </aside>
            )}
            {renderExports?.(context, exportSelection, tab, () =>
              setExportSelection(null),
            )}
          </section>
          <div className="dc-notice">
            현재 권한과 기관 범위에 포함된 데이터만 표시합니다. 상담 내용·비공개
            메모는 제공하지 않습니다.{" "}
            {context.limits.provisional ? "반출 정책은 잠정 운영안입니다." : ""}
          </div>
        </>
      )}
    </main>
  );
}
