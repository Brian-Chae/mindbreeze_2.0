// @vitest-environment jsdom
// SDD-258 — 기관관리자 초대 폼이 role=org_admin 으로 API 를 호출한다
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import CounselorInviteSection from "../src/components/org/counselor-invite-section";

vi.mock("../src/lib/api/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api/org")>()),
  inviteCounselor: vi.fn().mockResolvedValue({}),
  resendCounselorInvite: vi.fn(),
}));
import { inviteCounselor } from "../src/lib/api/org";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(role?: "org_admin") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CounselorInviteSection
        orgId="org-1"
        inviteList={[]}
        showList={false}
        inviteRole={role}
        onRefresh={async () => {}}
      />,
    );
  });
  const inputs = host.querySelectorAll("input");
  await act(async () => {
    setValue(inputs[0], "홍길동");
    setValue(inputs[1], "a@b.co");
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const heading = host.querySelector("h2")!.textContent;
  root.unmount();
  return heading;
}

describe("SDD-258 기관관리자 초대", () => {
  beforeEach(() => vi.clearAllMocks());

  it("org_admin 이면 role 을 실어 호출하고 제목이 바뀐다", async () => {
    const heading = await submit("org_admin");
    expect(heading).toBe("기관관리자 초대");
    expect(inviteCounselor).toHaveBeenCalledWith("org-1", {
      name: "홍길동",
      email: "a@b.co",
      role: "org_admin",
    });
  });

  it("기본은 role 없이 코치 초대(하위호환)", async () => {
    const heading = await submit();
    expect(heading).toBe("코치 초대");
    expect(inviteCounselor).toHaveBeenCalledWith("org-1", { name: "홍길동", email: "a@b.co" });
  });
});
