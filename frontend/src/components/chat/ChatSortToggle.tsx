interface Props {
  unreadFirst: boolean;
  onUnreadFirstChange: (value: boolean) => void;
}

export function ChatSortToggle({ unreadFirst, onUnreadFirstChange }: Props) {
  return (
    <div className="flex items-center justify-between border-b border-[#EFEFEF] px-4 py-3 shrink-0">
      <span className="text-xs font-semibold text-[#6F6F6F]">최신 대화순</span>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#6F6F6F]">
        <input type="checkbox" checked={unreadFirst} onChange={(event) => onUnreadFirstChange(event.target.checked)} className="h-4 w-4 accent-[#5F0080]" />
        안읽음 우선
      </label>
    </div>
  );
}
