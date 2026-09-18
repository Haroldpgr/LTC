import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Loader2 } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';

interface Props {
  onClose: () => void;
}

export function AdminLoginModal({ onClose }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const adminLogin = useInstanceStore((s) => s.adminLogin);

  const handleSubmit = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    const success = await adminLogin(password);
    setLoading(false);
    if (success) {
      onClose();
    } else {
      setError('Contraseña incorrecta');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="glass-card p-6 w-full max-w-sm mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
                <Lock size={16} className="text-primary-400" />
              </div>
              <h3 className="font-bold text-white">Acceso Admin</h3>
            </div>
            <button onClick={onClose} className="btn-ghost p-1">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Contraseña de administrador..."
              className="input-field"
              autoFocus
            />

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={loading || !password}
              className="btn-primary w-full"
            >
              {loading ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Entrar'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
