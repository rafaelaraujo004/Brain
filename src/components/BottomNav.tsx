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

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className="relative flex flex-col items-center justify-center gap-1 flex-1 h-full"
    >
      {({ isActive }) => (
        <>
          {/* Halo do item ativo — cresce sob o ícone em vez de trocar só a cor. */}
          <span
            className="absolute top-1.5 w-11 h-8 rounded-2xl transition-all duration-300"
            style={{
              background: isActive ? 'var(--color-primary-soft)' : 'transparent',
              transform: isActive ? 'scale(1)' : 'scale(0.6)',
              opacity: isActive ? 1 : 0,
            }}
          />
          <Icon
            size={20}
            strokeWidth={isActive ? 2.5 : 2}
            className="relative transition-all duration-300"
            style={{
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
              transform: isActive ? 'translateY(-1px)' : 'none',
            }}
          />
          <span
            className="relative text-[10px] font-semibold transition-colors duration-300"
            style={{
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
            }}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav
      className="glass fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch h-16 max-w-lg mx-auto px-1">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
