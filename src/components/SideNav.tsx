import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Receipt, RefreshCw, Settings, BarChart3, Brain } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Início' },
  { to: '/contas', icon: Receipt, label: 'Contas' },
  { to: '/recorrentes', icon: RefreshCw, label: 'Dívidas' },
  { to: '/analise', icon: BarChart3, label: 'Análise' },
  { to: '/assistente', icon: Brain, label: 'Assistente' },
  { to: '/config', icon: Settings, label: 'Configurações' },
];

export function SideNav() {
  return (
    <aside className="hidden md:flex flex-col w-60 min-h-screen bg-[var(--color-surface)] border-r border-[var(--color-border)] p-4 flex-shrink-0">
      <div className="flex items-center gap-3 px-3 mb-8">
        <div className="w-9 h-9 bg-[var(--color-primary)] rounded-xl flex items-center justify-center">
          <span className="text-white font-bold text-lg">$</span>
        </div>
        <span className="font-bold text-lg">Paguei</span>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-3 text-xs text-[var(--color-text-secondary)]">
        v1.0.0
      </div>
    </aside>
  );
}
