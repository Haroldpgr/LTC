import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Shield, Loader2, Lock, Eye, EyeOff, Zap, Trash2, Cpu, Package, Layers, Server, Palette } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useInstanceStore, type SavedAccount } from '@/stores/instanceStore';
import { AnimatedLogo } from '@/components/common/AnimatedLogo';
import { AccountAvatar } from '@/components/common/AccountAvatar';

export function LoginScreen() {
  const [mode, setMode] = useState<'select' | 'offline'>('select');
  const [offlineName, setOfflineName] = useState('');
  const [offlinePassword, setOfflinePassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { loginMicrosoft, loginOffline, isLoading, error, checkSession } = useAuthStore();
  const { savedAccounts, addSavedAccount, removeSavedAccount } = useInstanceStore();
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState('');

  const handleOpenCodePage = async () => {
    try {
      await invoke('open_ms_auth_page');
      setShowCodeDialog(true);
      setCodeError('');
    } catch (e) {
      setCodeError(String(e));
    }
  };

  const handleCodeLogin = async () => {
    if (!manualCode.trim()) return;
    setCodeBusy(true);
    setCodeError('');
    try {
      const acc = await invoke<{
        username: string;
        skinUrl?: string;
      }>('login_microsoft_with_code', { code: manualCode.trim() });
      addSavedAccount({
        username: acc.username,
        type: 'microsoft',
        skinUrl: acc.skinUrl,
        lastUsed: new Date().toISOString(),
      });
      await checkSession();
      setShowCodeDialog(false);
      setManualCode('');
    } catch (e) {
      setCodeError(String(e));
    }
    setCodeBusy(false);
  };

  const handleMicrosoft = async () => {
    try {
      const acc = await loginMicrosoft();
      if (acc) {
        addSavedAccount({
          username: acc.username,
          type: 'microsoft',
          skinUrl: acc.skinUrl,
          lastUsed: new Date().toISOString(),
        });
      }
    } catch {}
  };

  const handleOffline = async () => {
    if (!offlineName.trim() || !offlinePassword.trim()) return;
    if (offlinePassword !== confirmPassword) return;
    if (savedAccounts.length >= 3) return;
    try {
      await loginOffline(offlineName.trim());
      addSavedAccount({ username: offlineName.trim(), type: 'offline', lastUsed: new Date().toISOString() });
    } catch {}
  };

  const handleQuickLogin = async (account: SavedAccount) => {
    try {
      await loginOffline(account.username);
      addSavedAccount({ ...account, lastUsed: new Date().toISOString() });
    } catch {}
  };

  const nameTakenLocal = savedAccounts.some(
    (a) => a.username.toLowerCase() === offlineName.trim().toLowerCase()
  ) && offlineName.trim().length > 0;

  const canSubmit = offlineName.trim().length > 0 && offlinePassword.trim().length >= 4 &&
    offlinePassword === confirmPassword && savedAccounts.length < 3 && !nameTakenLocal;

  const particles = Array.from({ length: 15 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 3 + 1, delay: Math.random() * 5, duration: Math.random() * 10 + 10,
  }));

  return (
    <div className="h-full flex relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p) => (
          <motion.div key={p.id} className="absolute rounded-full bg-primary-400/15"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
            animate={{ y: [0, -30, 0], opacity: [0.2, 0.5, 0.2], scale: [1, 1.5, 1] }}
            transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
        <motion.div className="absolute top-20 right-20 w-72 h-72 bg-primary-600/8 rounded-full blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 8, repeat: Infinity }} />
        <motion.div className="absolute bottom-20 left-40 w-64 h-64 bg-accent-500/8 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 10, repeat: Infinity }} />
      </div>

      {/* Left - Login */}
      <div className="w-[420px] shrink-0 flex items-center justify-center relative z-10">
        <AnimatePresence mode="wait">
          {mode === 'select' ? (
            <motion.div key="select" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="w-full max-w-md px-10">
              <motion.div initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-dark-900/60 border border-primary-500/20 flex items-center justify-center shadow-2xl shadow-primary-500/30 overflow-hidden">
                <AnimatedLogo size={56} />
              </motion.div>

              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="text-3xl font-extrabold text-center text-white mb-1">LTC Launcher</motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
                className="text-dark-400 text-center text-sm mb-8">Tu portal al mundo de Minecraft</motion.p>

              {/* Quick login por tipo de cuenta */}
              {savedAccounts.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-5 space-y-4">
                  {([
                    { key: 'microsoft', title: 'Cuentas premium', accounts: savedAccounts.filter((a) => a.type === 'microsoft') },
                    { key: 'offline', title: 'Cuentas offline', accounts: savedAccounts.filter((a) => a.type !== 'microsoft') },
                  ]).filter((g) => g.accounts.length > 0).map((group) => (
                    <div key={group.key}>
                      <p className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        {group.key === 'microsoft'
                          ? <Shield size={12} className="text-emerald-400" />
                          : <Zap size={12} className="text-accent-400" />}
                        {group.title}
                        <span className="ml-auto text-[10px] text-dark-500 normal-case font-medium">{group.accounts.length}</span>
                      </p>
                      <div className="space-y-2">
                      {group.accounts.map((acc, i) => (
                      <motion.div key={acc.username} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}
                        whileHover={{ scale: 1.01, x: 3 }} whileTap={{ scale: 0.99 }}
                        onClick={() => handleQuickLogin(acc)}
                        className="w-full flex items-center gap-3 px-4 py-3 glass-card-hover cursor-pointer group">
                        <div className="shrink-0">
                          <AccountAvatar skinUrl={acc.skinUrl} username={acc.username} size={36} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                            <span className="truncate">{acc.username}</span>
                            {acc.type === 'microsoft' ? (
                              <span className="px-1.5 py-px rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">PREMIUM</span>
                            ) : (
                              <span className="px-1.5 py-px rounded text-[9px] font-bold bg-dark-700 text-dark-400 shrink-0">OFFLINE</span>
                            )}
                          </p>
                          <p className="text-[10px] text-dark-500 capitalize">{acc.type}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span onClick={(e) => { e.stopPropagation(); removeSavedAccount(acc.username); }}
                            className="p-1 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                            <Trash2 size={12} className="text-red-400" />
                          </span>
                          <motion.span animate={{ x: [0, 3, 0] }} transition={{ duration: 1.5, repeat: Infinity }} className="text-primary-400">
                            <Zap size={14} />
                          </motion.span>
                        </div>
                      </motion.div>
                      ))}
                      </div>
                    </div>
                    ))}
                </motion.div>
              )}

              <div className="space-y-3">
                <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                  whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }}
                  onClick={handleMicrosoft} disabled={isLoading}
                  className="w-full flex items-center gap-4 px-5 py-4 bg-[#2f7cd1]/10 hover:bg-[#2f7cd1]/15 border border-[#2f7cd1]/25 hover:border-[#2f7cd1]/40 rounded-xl transition-all duration-300 group">
                  <div className="w-10 h-10 rounded-xl bg-[#2f7cd1] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-lg shadow-[#2f7cd1]/25">
                    <Shield size={20} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-white text-sm">Cuenta Microsoft</p>
                    <p className="text-dark-500 text-xs">Login con tu cuenta Minecraft</p>
                  </div>
                </motion.button>

                <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                  whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }}
                  onClick={() => setMode('offline')} disabled={savedAccounts.length >= 3}
                  className="w-full flex items-center gap-4 px-5 py-4 glass-card-hover group disabled:opacity-40">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-lg shadow-accent-500/20">
                    <User size={20} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-white text-sm">Cuenta Offline</p>
                    <p className="text-dark-500 text-xs">{savedAccounts.length >= 3 ? 'Límite alcanzado (3/3)' : 'Crear con contraseña'}</p>
                  </div>
                </motion.button>
              </div>

              <button onClick={handleOpenCodePage} className="w-full text-center text-[11px] text-dark-500 hover:text-primary-300 transition-colors mt-1">
                ¿El navegador no completa el login? Entrar con código manual
              </button>
              {isLoading && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-primary-300 text-xs text-center mt-4">Se abrió tu navegador: completa el login de Microsoft ahí…</motion.p>}
              {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs text-center mt-4">{error}</motion.p>}
            </motion.div>
          ) : (
            <motion.div key="offline" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-md px-10">
              <div className="text-center mb-8">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}
                  className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shadow-xl shadow-accent-500/30">
                  <Lock size={28} className="text-white" />
                </motion.div>
                <h1 className="text-2xl font-bold text-white">Cuenta Segura</h1>
                <p className="text-dark-400 text-sm mt-1">Crea tu cuenta protegida con contraseña</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-dark-400 mb-1.5 ml-1">Nombre de usuario</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
                    <input type="text" value={offlineName} onChange={(e) => setOfflineName(e.target.value)}
                      placeholder="Tu nombre..." className="input-field pl-10" maxLength={16} autoFocus />
                  </div>
                  {nameTakenLocal && (
                    <p className="text-amber-400 text-xs mt-1 ml-1">Ya tienes esa cuenta: selecciónala en la lista.</p>
                  )}
                  <p className="text-dark-500 text-[10px] mt-1 ml-1">3-16 caracteres (letras, números, _). Los nombres premium están reservados y no se pueden repetir.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-400 mb-1.5 ml-1">Contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
                    <input type={showPassword ? 'text' : 'password'} value={offlinePassword}
                      onChange={(e) => setOfflinePassword(e.target.value)} placeholder="Mínimo 4..." className="input-field pl-10 pr-10" />
                    <span onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 cursor-pointer">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-dark-400 mb-1.5 ml-1">Confirmar contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repite..." className="input-field pl-10" />
                  </div>
                  {confirmPassword && offlinePassword !== confirmPassword && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs mt-1 ml-1">No coinciden</motion.p>
                  )}
                </div>
                {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                <div className="flex gap-3 pt-2">
                  <motion.button whileTap={{ scale: 0.98 }} onClick={() => setMode('select')} className="btn-secondary flex-1">Volver</motion.button>
                  <motion.button whileTap={{ scale: canSubmit ? 0.98 : 1 }} onClick={handleOffline} className="btn-primary flex-1"
                    disabled={isLoading || !canSubmit}>
                    {isLoading ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Crear Cuenta'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right - Decorative feature showcase */}
      <div className="hidden lg:flex flex-1 items-stretch relative overflow-hidden bg-gradient-to-br from-dark-900/80 via-dark-950 to-dark-900/50">
        {/* Ambient orbs */}
        <motion.div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary-600/5 rounded-full blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 10, repeat: Infinity }} />
        <motion.div className="absolute bottom-1/3 left-1/3 w-80 h-80 bg-accent-500/5 rounded-full blur-3xl"
          animate={{ scale: [1.1, 0.9, 1.1], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 12, repeat: Infinity }} />

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8 }}
          className="relative z-10 w-full flex flex-col items-center justify-center px-12 py-8">

          {/* Hero */}
          <div className="text-center mb-10">
            <motion.div initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.4 }}
              className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-dark-900/60 border border-primary-500/20 flex items-center justify-center shadow-2xl shadow-primary-500/25 overflow-hidden">
              <AnimatedLogo size={44} />
            </motion.div>
            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
              className="text-2xl font-extrabold text-white mb-2">Todo en un solo lugar</motion.h2>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
              className="text-dark-400 text-sm max-w-sm mx-auto">Gestiona mods, shaders, resource packs, modpacks y servidores desde un launcher ultrarrápido</motion.p>
          </div>

          {/* Feature grid - 3 columns */}
          <div className="grid grid-cols-3 gap-3 mb-8 w-full max-w-3xl">
            {[
              { icon: Package, title: 'Mods', desc: 'Modrinth + CurseForge', color: 'from-blue-500/20 to-blue-600/5', iconColor: 'text-blue-400', borderColor: 'border-blue-500/10' },
              { icon: Palette, title: 'Shaders', desc: 'BSL, Complementary, Iris...', color: 'from-purple-500/20 to-purple-600/5', iconColor: 'text-purple-400', borderColor: 'border-purple-500/10' },
              { icon: Layers, title: 'Modpacks', desc: 'Packs completos listos', color: 'from-amber-500/20 to-amber-600/5', iconColor: 'text-amber-400', borderColor: 'border-amber-500/10' },
              { icon: Server, title: 'Servidores', desc: 'Auto-conexión al entrar', color: 'from-accent-500/20 to-accent-600/5', iconColor: 'text-accent-400', borderColor: 'border-accent-500/10' },
              { icon: Cpu, title: 'Multi-instancia', desc: 'Perfiles independientes', color: 'from-rose-500/20 to-rose-600/5', iconColor: 'text-rose-400', borderColor: 'border-rose-500/10' },
              { icon: Shield, title: 'Cuentas seguras', desc: 'Protegidas con password', color: 'from-cyan-500/20 to-cyan-600/5', iconColor: 'text-cyan-400', borderColor: 'border-cyan-500/10' },
            ].map((feat, i) => (
              <motion.div key={feat.title}
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.07, type: 'spring', stiffness: 200 }}
                className={`flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border ${feat.borderColor} hover:bg-white/[0.04] transition-all duration-300 group`}>
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                  <feat.icon size={18} className={feat.iconColor} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{feat.title}</p>
                  <p className="text-[11px] text-dark-500 leading-tight mt-0.5">{feat.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Stats row */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
            className="flex items-center justify-center gap-8 mb-8">
            {[
              { value: '~10MB', label: 'RAM en uso' },
              { value: '<1s', label: 'Inicio' },
              { value: '2', label: 'Fuentes de mods' },
            ].map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 + i * 0.1 }} className="text-center">
                <p className="text-lg font-extrabold text-white">{stat.value}</p>
                <p className="text-[10px] text-dark-500">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Tech badges */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}
            className="flex flex-wrap items-center justify-center gap-2">
            {['Forge', 'Fabric', 'NeoForge', 'Quilt', 'Modrinth', 'CurseForge', 'Java 17', 'Tauri v2'].map((tech, i) => (
              <motion.span key={tech} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.5 + i * 0.04 }}
                className="px-3 py-1 bg-white/[0.03] rounded-full text-[11px] text-dark-400 border border-white/[0.05] hover:bg-white/[0.06] transition-colors">
                {tech}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* Diálogo de código manual (flujo nativeclient) */}
      <AnimatePresence>
        {showCodeDialog && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => !codeBusy && setShowCodeDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 16 }}
              className="glass-card w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-bold text-white text-sm mb-1">Entrar con código manual</h3>
              <p className="text-xs text-dark-400 mb-4">
                Se abrió el navegador: inicia sesión y Microsoft mostrará un código.
                Cópialo y pégalo aquí.
              </p>
              <textarea
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Pega aquí el código..."
                rows={3}
                className="input-field text-xs font-mono w-full"
              />
              {codeError && <p className="text-xs text-red-400 mt-2 break-words">{codeError}</p>}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowCodeDialog(false)} disabled={codeBusy} className="btn-secondary flex-1 disabled:opacity-50">
                  Cancelar
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCodeLogin}
                  disabled={codeBusy || !manualCode.trim()}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {codeBusy ? 'Verificando...' : 'Entrar'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
