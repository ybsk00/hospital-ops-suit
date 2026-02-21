'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BedDouble,
  // UserPlus,       // 입원관리 - 주석처리 (중복)
  // Syringe,        // 입원환자치료 - 주석처리 (중복)
  // CalendarClock,  // 외래예약 - 주석처리 (미구현)
  // Home,           // 가정방문 - 주석처리 (미구현)
  Inbox,
  Upload,
  ScrollText,
  Settings,
  LogOut,
  FileUp,
  ClipboardCheck,
  Megaphone,
  MessageCircle,
  BarChart3,
  Hand,
  Zap,
  ClipboardList,
  DoorOpen,
  FileCheck,
  ChevronDown,
  Building2,
  Stethoscope,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    key: 'admission',
    label: '입원관리',
    icon: Building2,
    items: [
      { href: '/dashboard/beds', label: '베드관리', icon: BedDouble },
      { href: '/dashboard/room-booking', label: '병실현황', icon: DoorOpen },
      { href: '/dashboard/handover', label: '인계장', icon: ClipboardList },
    ],
  },
  {
    key: 'treatment',
    label: '치료관리',
    icon: Stethoscope,
    items: [
      { href: '/dashboard/rf-evaluation', label: '고주파현황', icon: FileCheck },
      { href: '/dashboard/scheduling/manual-therapy', label: '도수현황', icon: Hand },
      { href: '/dashboard/scheduling/rf-schedule', label: '고주파예약', icon: Zap },
    ],
  },
  {
    key: 'visit',
    label: '방문치료',
    icon: Truck,
    items: [
      { href: '/dashboard/lab-uploads', label: '검사결과등록', icon: FileUp },
      { href: '/dashboard/lab-approvals', label: '검사결과승인', icon: ClipboardCheck },
      { href: '/dashboard/inbox', label: '업무함', icon: Inbox },
    ],
  },
  {
    key: 'marketing',
    label: '마케팅관리',
    icon: Megaphone,
    items: [
      { href: '/dashboard/marketing', label: '마케팅관리', icon: Megaphone },
      { href: '/dashboard/marketing/chatbot', label: '챗봇콘텐츠', icon: MessageCircle },
      { href: '/dashboard/marketing/analytics', label: '챗봇통계', icon: BarChart3 },
      { href: '/dashboard/marketing/chat-logs', label: '대화로그', icon: ScrollText },
    ],
  },
  {
    key: 'etc',
    label: '기타관리',
    icon: Settings,
    items: [
      { href: '/dashboard/imports', label: 'Import현황', icon: Upload },
      { href: '/dashboard/audit', label: '감사로그', icon: ScrollText },
      { href: '/dashboard/admin', label: '관리자설정', icon: Settings },
    ],
  },
];

/* 주석처리 메뉴 (중복/미구현)
  { href: '/dashboard/admissions', label: '입원 관리', icon: UserPlus },      // 중복 - 베드관리+병실현황으로 대체
  { href: '/dashboard/procedures', label: '입원환자치료', icon: Syringe },    // 중복 - 치료관리로 통합
  { href: '/dashboard/appointments', label: '외래 예약', icon: CalendarClock }, // 미구현
  { href: '/dashboard/homecare', label: '가정방문', icon: Home },              // 미구현
*/

function getActiveGroup(pathname: string): string | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        return group.key;
      }
    }
  }
  return null;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 현재 pathname에 해당하는 그룹 자동 펼침
  useEffect(() => {
    const activeGroup = getActiveGroup(pathname);
    if (activeGroup) {
      setExpanded((prev) => {
        if (prev.has(activeGroup)) return prev;
        const next = new Set(prev);
        next.add(activeGroup);
        return next;
      });
    }
  }, [pathname]);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
        {/* 대시보드 (단독 링크) */}
        <Link
          href="/dashboard"
          className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
            pathname === '/dashboard'
              ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <LayoutDashboard size={18} />
          <span>대시보드</span>
        </Link>

        {/* 그룹 메뉴 */}
        {navGroups.map((group) => {
          const isExpanded = expanded.has(group.key);
          const activeGroup = getActiveGroup(pathname);
          const isGroupActive = activeGroup === group.key;
          const GroupIcon = group.icon;

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  isGroupActive
                    ? 'text-blue-400'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <GroupIcon size={18} />
                <span className="flex-1 text-left font-medium">{group.label}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {isExpanded && (
                <div className="ml-4 border-l border-slate-700">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href || (pathname.startsWith(item.href + '/'));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 pl-5 pr-5 py-2 text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon size={16} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
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
