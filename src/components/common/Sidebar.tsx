import { motion } from 'framer-motion';
import {
  Gamepad2,
  Package,
  Image,
  Sun,
  Layers,
  LogOut,
  Shield,
  ChevronRight,
  Shirt,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useState } from 'react';
import { AdminLoginModal } from '@/components/admin/AdminLoginModal';
import { AnimatedLogo } from '@/components/common/AnimatedLogo';
import { InstanceIcon } from '@/components/common/InstanceIcon';

const contentCategories = [
  { id: 'mods' as const, label: 'Mods', icon: Package },
  { id: 'modpacks' as const, label: 'Modpacks', icon: Layers },
  { id: 'resourcepacks' as const, label: 'Resource Packs', icon: Image },
  { id: 'shaders' as const, label: 'Shaders', icon: Sun },
];

export function Sidebar() {
  const account = useAuthStore((s) => s.account);
  const logout = useAuthStore((s) => s.logout);
  const instances = useInstanceStore((s) => s.instances);
  const selectedInstance = useInstanceStore((s) => s.selectedInstance);
  const selectInstance = useInstanceStore((s) => s.selectInstance);
  const activeTab = useInstanceStore((s) => s.activeTab);
  const setActiveTab = useInstanceStore((s) => s.setActiveTab);
  const contentCategory = useInstanceStore((s) => s.contentCategory);
  const setContentCategory = useInstanceStore((s) => s.setContentCategory);
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <>
      <motion.aside
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-64 bg-dark-900/80 backdrop-blur-md border-r border-white/5 flex flex-col shrink-0 overflow-hidden"
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
          <AnimatedLogo size={26} />
          <div>
            <p className="text-sm font-bold text-white leading-none">LTC Launcher</p>
            <p className="text-[10px] text-dark-500 mt-0.5">Tu portal al mundo de Minecraft</p>
          </div>
        </div>

        {/* User section */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            {account?.skinUrl ? (
              <img
                src={account.skinUrl}
                alt={account.username}
                className="w-10 h-10 rounded-xl border border-white/10 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
                <span className="text-sm font-bold text-white">
                  {account?.username?.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{account?.username}</p>
              <p className="text-[11px] text-dark-400">
                {account?.type === 'microsoft' ? 'Microsoft' : 'Offline'}
              </p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 hover:bg-white/5 rounded-lg transition-colors group"
              title="Cerrar sesión"
            >
              <LogOut size={14} className="text-dark-500 group-hover:text-red-400 transition-colors" />
            </button>
          </div>
        </div>

        {/* Navigation tabs */}
        <div className="p-3 space-y-1">
          <button
            onClick={() => setActiveTab('instances')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'instances'
                ? 'bg-primary-600/20 text-primary-300 shadow-sm shadow-primary-500/10'
                : 'text-dark-400 hover:bg-white/5 hover:text-dark-200'
            }`}
          >
            <Gamepad2 size={16} />
            Instancias
            {instances.length > 0 && (
              <span className="ml-auto text-[10px] bg-dark-700 px-1.5 py-0.5 rounded-full text-dark-300">
                {instances.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('content')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'content'
                ? 'bg-primary-600/20 text-primary-300 shadow-sm shadow-primary-500/10'
                : 'text-dark-400 hover:bg-white/5 hover:text-dark-200'
            }`}
          >
            <Package size={16} />
            Contenido
            <ChevronRight
              size={14}
              className={`ml-auto transition-transform duration-200 ${
                activeTab === 'content' ? 'rotate-90' : ''
              }`}
            />
          </button>
          <button
            onClick={() => setActiveTab('skins')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'skins'
                ? 'bg-primary-600/20 text-primary-300 shadow-sm shadow-primary-500/10'
                : 'text-dark-400 hover:bg-white/5 hover:text-dark-200'
            }`}
          >
            <Shirt size={16} />
            Skins
          </button>
        </div>

        {/* Content categories (expandable) */}
        {activeTab === 'content' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 pb-2 space-y-0.5 overflow-hidden"
          >
            {contentCategories.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setContentCategory(cat.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ml-2 ${
                    contentCategory === cat.id
                      ? 'bg-white/5 text-white'
                      : 'text-dark-500 hover:text-dark-300 hover:bg-white/3'
                  }`}
                >
                  <Icon size={13} />
                  {cat.label}
                </button>
              );
            })}
          </motion.div>
        )}

        {/* Instances list */}
        {activeTab === 'instances' && instances.length > 0 && (
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            <p className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider px-3 mb-2">
              Mis Instancias
            </p>
            {instances.map((instance) => (
              <motion.button
                key={instance.id}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => selectInstance(instance)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  selectedInstance?.id === instance.id
                    ? 'bg-white/8 text-white shadow-sm'
                    : 'text-dark-400 hover:bg-white/5 hover:text-dark-200'
                }`}
              >
                <div className="w-6 h-6 rounded-md bg-dark-800/80 overflow-hidden shrink-0 flex items-center justify-center">
                  <InstanceIcon icon={instance.icon} className="text-base" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="truncate font-medium text-xs">{instance.name}</p>
                  <p className="text-[10px] text-dark-500">
                    MC {instance.mcVersion}
                    {instance.modLoader !== 'none' && ` · ${instance.modLoader}`}
                  </p>
                </div>
                {instance.isInstalled && (
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-400 shrink-0" />
                )}
              </motion.button>
            ))}
          </div>
        )}

        {/* Bottom section */}
        <div className="p-3 border-t border-white/5 space-y-1">
          <button
            onClick={() => setShowAdmin(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-dark-500 hover:bg-white/5 hover:text-dark-300 transition-all duration-200"
          >
            <Shield size={14} />
            Panel Admin
          </button>
        </div>
      </motion.aside>

      {showAdmin && <AdminLoginModal onClose={() => setShowAdmin(false)} />}
    </>
  );
}
