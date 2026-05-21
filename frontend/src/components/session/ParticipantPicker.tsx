// 참여자 다중 선택 + CSV 업로드 컴포넌트
import { useCallback, useEffect, useRef, useState } from 'react';
import { listClients, type ClientListItem } from '../../lib/api/clients';

export interface SelectedParticipant {
  userId: string;
  name: string;
  email: string;
}

interface Props {
  selected: SelectedParticipant[];
  onChange: (selected: SelectedParticipant[]) => void;
  maxParticipants: number;
}

export function ParticipantPicker({ selected, onChange, maxParticipants }: Props) {
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedIds = new Set(selected.map((s) => s.userId));

  const loadClients = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listClients({ q: q || undefined, size: 50 });
      setClients(res.clients);
    } catch {
      setError('내담자 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients(search);
  }, [search, loadClients]);

  const toggle = (c: ClientListItem) => {
    if (selectedIds.has(c.id)) {
      onChange(selected.filter((s) => s.userId !== c.id));
    } else {
      if (selected.length >= maxParticipants) {
        setError(`최대 ${maxParticipants}명까지 선택할 수 있습니다`);
        return;
      }
      setError(null);
      onChange([...selected, { userId: c.id, name: c.name, email: c.email }]);
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.split('\n').filter(Boolean);
      const header = lines[0].toLowerCase();
      if (!header.includes('email')) {
        setError('CSV 파일에 email 열이 필요합니다');
        return;
      }
      const emailIdx = header.split(',').findIndex((h) => h.trim() === 'email');
      const emails = lines.slice(1).map((line) => line.split(',')[emailIdx]?.trim()).filter(Boolean);
      if (emails.length === 0) {
        setError('유효한 이메일이 없습니다');
        return;
      }
      // CSV 이메일과 일치하는 클라이언트를 찾아 선택
      setSearch('');
      loadClients('').then(() => {
        // loadClients will update `clients` state; effect below handles matching
      });
      // Search for each email individually to find matches
      Promise.all(emails.map((email) => listClients({ q: email, size: 1 }))).then((results) => {
        const found: SelectedParticipant[] = [];
        results.forEach((res) => {
          res.clients.forEach((c) => {
            if (!selectedIds.has(c.id) && found.length + selected.length < maxParticipants) {
              found.push({ userId: c.id, name: c.name, email: c.email });
            }
          });
        });
        if (found.length > 0) {
          onChange([...selected, ...found]);
          setError(null);
        } else {
          setError('CSV에서 추가할 수 있는 내담자가 없습니다 (이미 선택됐거나 존재하지 않는 이메일)');
        }
      }).catch(() => setError('CSV 처리 중 오류'));
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const removeSelected = (userId: string) => {
    onChange(selected.filter((s) => s.userId !== userId));
  };

  const atLimit = selected.length >= maxParticipants;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-[#1F1F1F]">
          참여자 선택 ({selected.length}/{maxParticipants}명)
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs text-[#5F0080] font-medium hover:underline"
        >
          CSV로 추가
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleCsvUpload}
        />
      </div>

      {/* 선택된 참여자 칩 */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {selected.map((s) => (
            <span
              key={s.userId}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F5EDFC] text-[13px] text-[#5F0080] font-medium"
            >
              {s.name}
              <button
                type="button"
                onClick={() => removeSelected(s.userId)}
                className="text-[#9CA0AE] hover:text-[#5F0080] ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 검색 */}
      <input
        type="text"
        placeholder="내담자 검색..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 border border-[#DDDEE7] rounded-lg bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] mb-2"
      />

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {/* 내담자 목록 */}
      <div className="max-h-48 overflow-y-auto border border-[#EFEFEF] rounded-lg divide-y divide-[#EFEFEF]">
        {loading ? (
          <div className="p-4 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
        ) : clients.length === 0 ? (
          <div className="p-4 text-center text-sm text-[#6F6F6F]">검색 결과가 없습니다</div>
        ) : (
          clients.map((c) => {
            const isSelected = selectedIds.has(c.id);
            const disabled = !isSelected && atLimit;
            return (
              <label
                key={c.id}
                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${
                  disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#F8F8FB]'
                } ${isSelected ? 'bg-[#F5EDFC]' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(c)}
                  disabled={disabled}
                  className="accent-[#5F0080]"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1F1F1F] truncate">{c.name}</div>
                  <div className="text-xs text-[#6F6F6F] truncate">{c.email}</div>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
