import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Barra lateral — desktop */}
      <SideNav />

      {/* Conteúdo. A `key` na rota faz o React remontar a área a cada
          navegação, o que reinicia as animações de entrada e dá a sensação
          de troca de tela em vez de substituição de conteúdo. */}
      <main className="flex-1 min-w-0 pb-24 md:pb-8 px-4 pt-3 md:px-8 md:pt-6 md:ml-64">
        <div key={location.pathname} className="max-w-3xl mx-auto w-full animate-fade">
          <Outlet />
        </div>
      </main>

      {/* Navegação inferior — mobile */}
      <BottomNav />
    </div>
  );
}
