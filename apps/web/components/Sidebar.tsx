'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BedDouble,
  UserPlus,
  Syringe,
  CalendarClock,
  Home,
  Inbox,
  Upload,
  ScrollText,
  Settings,
  LogOut,
  Sparkles,
  FlaskConical,
  FileUp,
  ClipboardCheck,
  Megaphone,
  MessageCircle,
  BarChart3,
  Hand,
  Zap,
  ClipboardList,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';

const navItems = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/dashboard/beds', label: '베드 관리', icon: BedDouble },
  { href: '/dashboard/admissions', label: '입원 관리', icon: UserPlus },
  { href: '/dashboard/procedures', label: '입원환자치료', icon: Syringe },
  { href: '/dashboard/appointments', label: '외래 예약', icon: CalendarClock },
  { href: '/dashboard/homecare', label: '가정방문', icon: Home },
  { href: '/dashboard/lab-uploads', label: '검사결과 등록', icon: FileUp },
  { href: '/dashboard/lab-approvals', label: '검사결과 승인', icon: ClipboardCheck },
  { href: '/dashboard/inbox', label: '업무함', icon: Inbox },
  { href: '/dashboard/imports', label: 'Import 현황', icon: Upload },
  { href: '/dashboard/scheduling/manual-therapy', label: '도수예약', icon: Hand },
  { href: '/dashboard/scheduling/rf-schedule', label: '고주파예약', icon: Zap },
  { href: '/dashboard/audit', label: '감사로그', icon: ScrollText },
  { href: '/dashboard/marketing', label: '마케팅 관리', icon: Megaphone },
  { href: '/dashboard/marketing/chatbot', label: '└ 챗봇 콘텐츠', icon: MessageCircle },
  { href: '/dashboard/marketing/analytics', label: '└ 챗봇 통계', icon: BarChart3 },
  { href: '/dashboard/admin', label: '관리자 설정', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="w-60 bg-slate-900 text-white flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <div>
            <div className="font-semibold text-sm">서울온케어</div>
            <div className="text-xs text-slate-400">병원관리 시스템</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Info */}
      <div className="px-5 py-4 border-t border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="text-xs text-slate-400">
              {user?.departments?.[0]?.departmentName || (user?.isSuperAdmin ? '시스템관리자' : '')}
            </div>
          </div>
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
            title="로그아웃"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
