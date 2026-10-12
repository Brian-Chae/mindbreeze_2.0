import { useEffect } from 'react';
import SidebarNav from './SidebarNav';
import { useNotificationStore } from '../../stores/notificationStore';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  role?: 'counselor' | 'client';
}

export default function MobileDrawer({ open, onClose, role = 'counselor' }: MobileDrawerProps) {
  const unread = useNotificationStore((s) => s.unread);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 max-w-[80vw] bg-[#F5EDFC] border-r border-[#EFEFEF] overflow-y-auto transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <SidebarNav onNavigate={onClose} role={role} notificationBadge={unread} />
      </aside>
    </>
  );
}
