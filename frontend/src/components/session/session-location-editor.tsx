import { useState } from 'react';
import { updateSession, type LocationType, type SessionDto } from '../../lib/api/session';
import { getLocationAddressDefault, getLocationAddressPayload, isLocationAddressVisible } from '../../lib/class/session-location';

interface SessionLocationEditorProps {
  session: SessionDto;
  onSaved: (session: SessionDto) => void;
  onCancel: () => void;
}

/** 편집 중 폴링 응답이 입력값을 덮어쓰지 않도록 별도 편집 상태를 유지한다. */
export function SessionLocationEditor({ session, onSaved, onCancel }: SessionLocationEditorProps) {
  const [locationType, setLocationType] = useState<LocationType>(session.location_type);
  const [address, setAddress] = useState(() => getLocationAddressDefault(session));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateSession(session.id, {
        location_type: locationType,
        location_address: getLocationAddressPayload(locationType, address),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '장소를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <label htmlFor="edit-location-type" className="block text-sm font-medium">장소 유형</label>
      <select id="edit-location-type" value={locationType} disabled={saving} onChange={(event) => setLocationType(event.target.value as LocationType)} className="w-full rounded-xl border border-[#DDD0EA] px-3 py-2 text-sm">
        <option value="offline">오프라인 (대면)</option>
        <option value="online">온라인 (원격)</option>
      </select>
      {isLocationAddressVisible(locationType) && (
        <div>
          <label htmlFor="edit-location-address" className="mb-1 block text-sm font-medium">장소 (주소)</label>
          <input id="edit-location-address" value={address} disabled={saving} onChange={(event) => setAddress(event.target.value)} maxLength={300} placeholder="상담 장소 주소를 입력해 주세요" className="w-full rounded-xl border border-[#DDD0EA] px-3 py-2 text-sm focus:ring-2 focus:ring-[#5F0080]" />
          <p className="mt-1 text-xs text-[#6F6F6F]">비워 두면 기관 또는 상담사 프로필의 기본 주소가 사용됩니다.</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-[#B3261E]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="mb-btn text-sm">{saving ? '저장 중...' : '장소 저장'}</button>
        <button type="button" disabled={saving} onClick={onCancel} className="mb-btn mb-btn--ghost text-sm">취소</button>
      </div>
    </form>
  );
}
