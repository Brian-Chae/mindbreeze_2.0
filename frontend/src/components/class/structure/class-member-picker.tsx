import { useEffect, useId, useState } from 'react';
import { searchClassMemberCandidates, type ClassMemberCandidates } from '../../../lib/api/class-member-candidates';
import { useAuthStore } from '../../../stores/authStore';

export interface ClassMemberSelection { userId: string; name: string; maskedEmail?: string | null }
interface Props {
  classId?: string;
  selected: ClassMemberSelection[];
  onChange: (selected: ClassMemberSelection[]) => void;
  maxParticipants: number;
  excludeUserIds?: string[];
  className?: string;
  disabled?: boolean;
}
/** 클래스 초대 전용. 상담 정보나 원문 이메일을 보관하지 않는다. */
export function ClassMemberPicker({ classId, selected, onChange, maxParticipants, excludeUserIds = [], className = '', disabled = false }: Props) {
  const user = useAuthStore(state => state.user);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ scope: string; data: ClassMemberCandidates } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const scope = JSON.stringify([user?.id, user?.role, classId, query]);
  const labelId = useId();
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    if (disabled) return () => controller.abort();
    const timer = setTimeout(() => {
      void searchClassMemberCandidates({ classId, query }, controller.signal).then(data => {
        if (active) { setResult({ scope, data }); setFailure(null); }
      }).catch(() => {
        if (active) setFailure({ scope, message: '회원을 불러오지 못했어요. 검색어를 다시 입력해 주세요.' });
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [scope, classId, query, disabled]);
  const current = result?.scope === scope ? result.data : null;
  const error = failure?.scope === scope ? failure.message : null;
  const rows = current?.members.filter(member => !excludeUserIds.includes(member.id)) ?? [];
  const atLimit = selected.length >= Math.max(0, maxParticipants);
  const remove = (id: string) => onChange(selected.filter(member => member.userId !== id));
  return <section className={`class-member-picker space-y-3 ${className}`} data-class-member-picker>
    <label htmlFor={labelId} className="block text-sm font-medium">회원 검색 <span className="text-gray-500">{selected.length}/{Math.max(0, maxParticipants)}명 선택</span></label>
    {selected.length > 0 && <div className="class-member-picker__selected flex flex-wrap gap-2">{selected.map(member => <span key={member.userId} className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-sm text-purple-900">{member.name}<button type="button" disabled={disabled} aria-label={`${member.name} 선택 취소`} onClick={() => remove(member.userId)}>×</button></span>)}</div>}
    <input id={labelId} className="class-member-picker__search w-full rounded-xl border border-[#e5dfd6] bg-white px-3 py-2 text-sm" type="search" value={query} maxLength={254} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="이름이나 정확한 이메일로 찾아요" />
    <p className="class-member-picker__hint text-xs text-gray-500">이름으로 찾을 수 없는 회원은 정확한 이메일을 입력해 주세요.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="class-member-picker__list max-h-60 overflow-y-auto rounded-xl border border-[#e5dfd6] divide-y divide-[#eee9e2]">
      {!current && !error && !disabled && <p role="status" className="p-4 text-sm text-gray-500">회원을 찾는 중이에요.</p>}
      {current && !rows.length && <p className="p-4 text-sm text-gray-500">선택할 회원이 없어요. 정확한 이메일을 확인하거나 이메일로 초대해 주세요.</p>}
      {rows.map(member => {
        const chosen = selected.some(item => item.userId === member.id);
        const name = member.name ?? '이름 미확인';
        return <label className="class-member-picker__row flex items-center gap-3 p-3 text-sm" key={member.id}>
          <span aria-hidden="true" className="class-member-picker__avatar flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600">{name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><span className="class-member-picker__name block truncate font-medium">{name}</span><span className="class-member-picker__email block truncate text-xs text-gray-500">{member.masked_email}</span></span>
          <input type="checkbox" aria-label={`${name} 선택`} checked={chosen} disabled={disabled || (!chosen && atLimit)} onChange={() => chosen ? remove(member.id) : onChange([...selected, { userId: member.id, name, maskedEmail: member.masked_email }])} />
        </label>;
      })}
    </div>
    {current?.has_more && <p className="text-xs text-gray-500">검색 결과가 더 있어요. 이름을 더 입력해 주세요.</p>}
    {atLimit && <p className="text-sm text-amber-800">정원을 모두 선택했어요. 선택을 해제하면 다른 회원을 고를 수 있어요.</p>}
  </section>;
}
