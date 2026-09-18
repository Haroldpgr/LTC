import { motion } from 'framer-motion';
import { LogOut, Settings, Shield } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { InstanceCard } from './InstanceCard';
import { useState } from 'react';
import { AdminLoginModal } from '@/components/admin/AdminLoginModal';

export function HomeScreen() {
  const account = useAuthStore((s) => s.account);
  const logout = useAuthStore((s) => s.logout);
  const instances = useInstanceStore((s) => s.instances);
  const launcherState = useInstanceStore((s) => s.launcherState);
  const [showAdminModal, setShowAdminModal] = useState(false);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          {account?.skinUrl ? (
            <img
              src={account.skinUrl}
              alt={account.username}
              className="w-9 h-9 rounded-lg border border-white/10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <span className="text-sm font-bold text-white">
                {account?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-white">{account?.username}</p>
            <p className="text-xs text-dark-400">
              {account?.type === 'microsoft' ? 'Cuenta Microsoft' : 'Modo Offline'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdminModal(true)}
            className="btn-ghost p-2"
            title="Panel Admin"
          >
            <Shield size={18} />
          </button>
          <button onClick={logout} className="btn-ghost p-2" title="Cerrar sesión">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Status bar */}
      {(launcherState.isLaunching || launcherState.isInstalling) && (
        <div className="px-6 py-2 bg-primary-600/10 border-b border-primary-500/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            <p className="text-xs text-primary-300">{launcherState.statusMessage}</p>
          </div>
          {launcherState.downloadProgress && (
            <div className="mt-1.5">
              <div className="h-1 bg-dark-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${launcherState.downloadProgress.percentage}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-[10px] text-dark-400 mt-0.5">
                {launcherState.downloadProgress.fileName} — {launcherState.downloadProgress.percentage.toFixed(0)}%
              </p>
            </div>
          )}
        </div>
      )}

      {launcherState.error && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{launcherState.error}</p>
        </div>
      )}

      {/* Instance grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-dark-800 flex items-center justify-center">
                <Settings size={28} className="text-dark-500" />
              </div>
              <p className="text-dark-400 text-sm">No hay instancias disponibles</p>
              <p className="text-dark-500 text-xs mt-1">
                El administrador debe configurar una instancia
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {instances.map((instance, i) => (
              <motion.div
                key={instance.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <InstanceCard instance={instance} />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {showAdminModal && (
        <AdminLoginModal onClose={() => setShowAdminModal(false)} />
      )}
    </div>
  );
}
