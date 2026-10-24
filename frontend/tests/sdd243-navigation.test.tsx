// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import context from "../../specs/sdd-243-platform-data-center/contracts/fixtures/context.json";
import classes from "../../specs/sdd-243-platform-data-center/contracts/fixtures/class-list.json";
import {
  dataCenterGet,
  formatCount,
  visibleDataCenterTabs,
} from "../src/lib/api/data-center";
vi.mock("../src/lib/api/client", () => ({
  apiClient: { get: vi.fn().mockResolvedValue(classes) },
}));
import { apiClient } from "../src/lib/api/client";
describe("SDD-243 탐색 계약", () => {
  it("기관에는 플랫폼 전용 탭을 숨긴다", () => {
    expect(visibleDataCenterTabs(context).map((t) => t.key)).not.toContain(
      "retention",
    );
    expect(visibleDataCenterTabs(context).map((t) => t.key)).toContain(
      "classes",
    );
  });
  it("미집계와 확인된 0을 구분한다", () => {
    expect(
      formatCount({
        value: null,
        partial: false,
        unavailable_reason: "미집계",
      }),
    ).toBe("미집계");
    expect(formatCount({ value: 0, partial: false })).toBe("0");
  });
  it("B01 경로와 기관·검색·cursor를 전달한다", async () => {
    const result = await dataCenterGet("/classes", {
      org_id: "org A",
      q: "호흡",
      cursor: "next",
    });
    expect(result).toEqual(classes);
    expect(apiClient.get).toHaveBeenCalledWith(
      "/data-center/classes?org_id=org+A&q=%ED%98%B8%ED%9D%A1&cursor=next",
      expect.objectContaining({ signal: undefined }),
    );
  });
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { DataCenterWorkspace } from "../src/pages/data-center/data-center-page";
import summary from "../../specs/sdd-243-platform-data-center/contracts/fixtures/summary.json";
import sessions from "../../specs/sdd-243-platform-data-center/contracts/fixtures/class-sessions.json";
import participants from "../../specs/sdd-243-platform-data-center/contracts/fixtures/session-participants.json";
vi.mock("../src/components/layout/AppShell", () => ({ default: () => null }));
it("클래스→회차→참여자를 fixture로 탐색하고 밴드 미사용을 정상 표시한다", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
    path.includes("/summary")
      ? summary
      : path.includes("/participants")
        ? participants
        : path.includes("/sessions")
          ? sessions
          : classes,
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<DataCenterWorkspace context={context} />));
  const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  expect(container.textContent).toContain("기관A 데이터 센터");
  expect(container.textContent).not.toContain("보관·삭제");
  await click("회차 보기 →");
  expect(container.textContent).toContain("3회차");
  await click("참여자 보기 →");
  expect(container.textContent).toContain("정상 · 밴드 미사용");
  expect(container.textContent).toContain("P01");
  await act(async () => root.unmount());
  container.remove();
});
it("사용자 상세 열람의 늦은 응답은 탭 전환 뒤 폐기한다", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const subjects = (
    await import("../../specs/sdd-243-platform-data-center/contracts/fixtures/subjects.json")
  ).default;
  vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
    path.includes("/summary")
      ? summary
      : path.includes("/subjects")
        ? subjects
        : path.includes("/sessions")
          ? sessions
          : classes,
  );
  let resolveContact: (value: {
    phone: string;
    birth_date: null;
  }) => void = () => {};
  Object.assign(apiClient, {
    post: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveContact = resolve;
        }),
    ),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<DataCenterWorkspace context={context} />));
  const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  await click("사용자 데이터");
  await click("회차 보기 →");
  await click("개인정보 개별 열람");
  await click("클래스 데이터");
  await act(async () =>
    resolveContact({ phone: "010-0000-0000", birth_date: null }),
  );
  expect(container.textContent).not.toContain("010-0000-0000");
  await act(async () => root.unmount());
  container.remove();
});
it("기관별 그룹은 각각의 헤더 아래 항목을 분리한다", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
    path.includes("/summary")
      ? summary
      : {
          ...classes,
          items: [
            classes.items[0],
            {
              ...classes.items[0],
              class_id: "other",
              org_name: "기관B",
              title: "다른 기관 클래스",
            },
          ],
        },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<DataCenterWorkspace context={context} />));
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="그룹 보기"]',
    )!;
    select.value = "group";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(
    Array.from(container.querySelectorAll(".dc-group-row")).map(
      (row) => row.textContent,
    ),
  ).toEqual(["기관A", "기관B"]);
  await act(async () => root.unmount());
});
it("플랫폼 하위 탭은 계약 경로별 안전한 한국어 투영으로 조회한다", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const platform = {
    ...context,
    role: "platform_admin",
    capabilities: {
      ...context.capabilities,
      tabs: ["overview", "classes", "consents", "retention", "standard"],
    },
  };
  const examples: Record<string, object> = {
    "/inventory": {
      kind: "eeg",
      label: "EEG 원본",
      storage_category: "S3",
      retention_policy: "90일",
      count: { value: 0, partial: false },
      exportable: true,
    },
    "/consents": {
      scope: "collection",
      subject_ref: "P01",
      notice_version: "v1",
      state: "agreed",
      at: null,
      export_state: null,
    },
    "/research-batches": {
      batch_id: "B01",
      status: "ready",
      created_at: "2026-10-24T00:00:00Z",
      file_count: 1,
      total_bytes: 100,
      acked_at: null,
    },
    "/retention-runs": {
      run_id: "R01",
      mode: "dry_run",
      status: "done",
      started_at: "2026-10-24T00:00:00Z",
      finished_at: null,
    },
    "/retention-candidates": {
      kind: "EEG",
      ref: "P02",
      deadline: null,
      reason: "research_hold",
    },
    "/account-deletions": {
      source: "request",
      ref: "D01",
      status: "received",
      received_at: null,
      grace_until: null,
    },
    "/baselines": {
      baseline_id: 1,
      pipeline_version: "v2",
      is_active: true,
      created_at: "2026-10-24T00:00:00Z",
    },
  };
  vi.mocked(apiClient.get).mockImplementation(async (path: string) => {
    if (path.includes("/summary")) return summary;
    const item = Object.entries(examples).find(([key]) =>
      path.includes(key),
    )?.[1];
    return item
      ? {
          items: [item],
          as_of: "2026-10-24T00:00:00Z",
          next_cursor: null,
          total: 1,
        }
      : classes;
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(<DataCenterWorkspace context={platform} />),
  );
  const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  for (const [tab, expected, path] of [
    ["개요", "EEG 원본", "/inventory"],
    ["동의·연구", "수집 동의", "/consents"],
    ["연구 배치", "수신 확인 전", "/research-batches"],
    ["보관·삭제", "사전 점검", "/retention-runs"],
    ["삭제 후보", "연구 보류", "/retention-candidates"],
    ["계정 삭제 접수·원장", "공개 접수", "/account-deletions"],
    ["표준 데이터", "기준 측정 1", "/baselines"],
  ]) {
    await click(tab);
    expect(container.textContent).toContain(expected);
    expect(
      vi
        .mocked(apiClient.get)
        .mock.calls.some((call) => String(call[0]).includes(path)),
    ).toBe(true);
  }
  expect(container.textContent).not.toContain("pipeline_version");
  await act(async () => root.unmount());
});

vi.mock('../src/components/data-center/measurement-detail',()=>({MeasurementDetail:({sessionId,participantId}:{sessionId:string;participantId:string})=><div data-testid="measurement-default">측정 데이터 {sessionId} {participantId}</div>}));
it('측정 상세 클릭은 기본 MeasurementDetail 컴포넌트를 연결한다',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 vi.mocked(apiClient.get).mockImplementation(async(path:string)=>path.includes('/summary')?summary:path.includes('/participants')?participants:path.includes('/sessions')?sessions:classes);
 const element=document.createElement('div');const root=createRoot(element);
 await act(async()=>root.render(<DataCenterWorkspace context={context}/>));
 for(const text of ['회차 보기 →','참여자 보기 →','측정 상세 →']) {
  const button=Array.from(element.querySelectorAll('button')).find(item=>item.textContent===text)!;
  await act(async()=>button.click());
 }
 expect(element.querySelector('[data-testid="measurement-default"]')).not.toBeNull();
 await act(async()=>root.unmount());
});
