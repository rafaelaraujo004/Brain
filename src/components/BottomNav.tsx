import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Receipt, RefreshCw, Settings, BarChart3, Brain } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Início' },
  { to: '/contas', icon: Receipt, label: 'Contas' },
  { to: '/recorrentes', icon: RefreshCw, label: 'Dívidas' },
  { to: '/analise', icon: BarChart3, label: 'Análise' },
  { to: '/assistente', icon: Brain, label: 'IA' },
  { to: '/config', icon: Settings, label: 'Config' },
];

function NavItem({ to, icon: Icon, label }: { to: string; icon: typeof LayoutDashboard; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors duration-150 ${
          isActive
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
          <span className="text-[10px] font-medium">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] z-50 safe-area-bottom md:hidden">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
