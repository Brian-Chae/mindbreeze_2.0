// 새 채팅방 생성 모달 — 내담자 선택 → 1:1 채팅방 생성
import { useCallback, useEffect, useState } from 'react';
import { createDirectRoom } from '../../lib/api/chat';
import { listClients, type ClientListItem } from '../../lib/api/clients';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateRoomModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (open) {
      loadClients(search);
    }
  }, [search, open, loadClients]);

  const handleCreate = async (client: ClientListItem): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const room = await createDirectRoom({ client_id: client.id, room_type: 'direct' });
      onClose();
      navigate(`/chat/${room.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '채팅방 생성에 실패했습니다');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1F1F1F]">새 채팅방</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#6F6F6F] flex items-center justify-center text-sm"
          >
            ✕
          </button>
        </div>

        <input
          type="text"
          placeholder="내담자 이름 또는 이메일 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] mb-3"
        />

        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}

        <div className="max-h-64 overflow-y-auto border border-[#EFEFEF] rounded-xl divide-y divide-[#EFEFEF]">
          {loading ? (
            <div className="p-4 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
          ) : clients.length === 0 ? (
            <div className="p-4 text-center text-sm text-[#6F6F6F]">검색 결과가 없습니다</div>
          ) : (
            clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCreate(c)}
                disabled={creating}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F8FB] transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold text-sm shrink-0">
                  {c.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1F1F1F] truncate">{c.name}</div>
                  <div className="text-xs text-[#6F6F6F] truncate">{c.email}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
