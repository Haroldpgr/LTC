import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AnimatedLogo } from '@/components/common/AnimatedLogo';

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="titlebar-drag h-9 bg-dark-900/95 backdrop-blur-sm border-b border-white/5 flex items-center justify-between px-2 shrink-0"
    >
      <div className="flex items-center gap-2 titlebar-no-drag">
        <AnimatedLogo size={18} />
        <span className="text-xs font-medium text-dark-400">LTC Launcher</span>
      </div>

      <div className="flex items-center titlebar-no-drag">
        <button
          onClick={() => appWindow.minimize()}
          className="w-9 h-9 flex items-center justify-center hover:bg-white/10 transition-colors rounded"
        >
          <Minus size={14} className="text-dark-400" />
        </button>
        <button
          onClick={() => appWindow.maximize()}
          className="w-9 h-9 flex items-center justify-center hover:bg-white/10 transition-colors rounded"
        >
          <Square size={11} className="text-dark-400" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-9 h-9 flex items-center justify-center hover:bg-red-500/80 transition-colors rounded"
        >
          <X size={14} className="text-dark-400" />
        </button>
      </div>
    </div>
  );
}
