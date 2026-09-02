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
    <aside className="hidden md:flex flex-col w-64 h-screen fixed left-0 top-0 border-r border-[var(--color-border)] p-4 z-40 bg-[var(--color-bg)]">
      <div className="flex items-center gap-3 px-3 mb-9 mt-2">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-extrabold text-lg"
          style={{
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            boxShadow: 'var(--shadow-primary)',
          }}
        >
          P
        </div>
        <div className="leading-tight">
          <p className="font-extrabold text-[17px] tracking-tight">Paguei</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Controle mensal</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* A pílula de fundo do item ativo, com a cor da marca. */}
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-2xl border border-[var(--color-border)]"
                    style={{
                      background:
                        'linear-gradient(120deg, var(--color-primary-soft), transparent 70%)',
                    }}
                  />
                )}
                {/* Marcador na borda esquerda — mostra a posição sem depender
                    só de cor, que some para quem não distingue violeta. */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                  />
                )}
                <Icon
                  size={19}
                  className={`relative transition-colors ${
                    isActive ? 'text-[var(--color-primary)]' : ''
                  }`}
                  strokeWidth={isActive ? 2.4 : 2}
                />
                <span className="relative">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-3 text-[11px] text-[var(--color-text-tertiary)]">v1.0.0</div>
    </aside>
  );
}
