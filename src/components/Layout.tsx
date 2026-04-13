import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { SideNav } from './SideNav';

export function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar - desktop only */}
      <SideNav />

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-6 px-4 pt-4 md:px-8 md:pt-6 max-w-5xl mx-auto w-full">
        <Outlet />
      </main>

      {/* Bottom nav - mobile only */}
      <BottomNav />
    </div>
  );
}
