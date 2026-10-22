import type { MemberType } from '../../lib/api/clients';
import { MEMBER_TYPE_HELP, MEMBER_TYPE_LABEL } from '../../lib/clients/member-type';

export default function MemberTypeBadge({ type }: { type?: MemberType | null }) {
  if (!type) return null;
  const tone = type === 'member' ? 'bg-[#F5EDFC] text-[#5F0080]' : 'bg-[#F3F3F3] text-[#555]';
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${tone}`}
      title={MEMBER_TYPE_HELP[type]}
      data-testid="member-type-badge"
    >
      {MEMBER_TYPE_LABEL[type]}
    </span>
  );
}
