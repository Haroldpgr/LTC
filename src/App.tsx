import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { TitleBar } from '@/components/common/TitleBar';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { Sidebar } from '@/components/common/Sidebar';
import { MainContent } from '@/components/home/MainContent';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { UpdateDialog } from '@/components/common/UpdateDialog';
import { SplashScreen } from '@/components/common/SplashScreen';

export default function App() {
  const account = useAuthStore((s) => s.account);
  const checkSession = useAuthStore((s) => s.checkSession);
  const loadInstances = useInstanceStore((s) => s.loadInstances);
  const syncCatalog = useInstanceStore((s) => s.syncCatalog);
  const syncOfficialSources = useInstanceStore((s) => s.syncOfficialSources);
  const isAdmin = useInstanceStore((s) => s.isAdmin);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (account) {
      // Al entrar: cargar instancias, traer el catálogo oficial del servidor
      // (las instancias del admin aparecen solas) y sincronizar sus mods.
      // Todo en silencio, sin bloquear la interfaz.
      (async () => {
        await loadInstances();
        await syncCatalog();
        syncOfficialSources().catch(() => {});
      })();
    }
  }, [account, loadInstances, syncCatalog, syncOfficialSources]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden select-none bg-dark-950">
      <TitleBar />
      <main className="flex-1 overflow-hidden flex">
        {!account ? (
          <LoginScreen />
        ) : isAdmin ? (
          <AdminPanel />
        ) : (
          <>
            <Sidebar />
            <MainContent />
          </>
        )}
      </main>
      <UpdateDialog />
      <AnimatePresence>{showSplash && <SplashScreen />}</AnimatePresence>
    </div>
  );
}
