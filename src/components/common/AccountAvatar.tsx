import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SkinFace } from '@/components/common/SkinFace';

const memCache = new Map<string, string>();

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // almacenamiento lleno o bloqueado: se sigue sin caché
  }
}

interface AccountAvatarProps {
  skinUrl?: string;
  username: string;
  uuid?: string;
  size?: number;
}

// Avatar de cuenta: skin real si hay, si no la cabeza Steve/Alex por defecto
// (descargada una vez y cacheada), y mientras carga, la inicial.
export function AccountAvatar({ skinUrl, username, uuid, size = 36 }: AccountAvatarProps) {
  const [defSkin, setDefSkin] = useState<string | null>(null);

  useEffect(() => {
    if (skinUrl || !username) return;
    const key = `ltc-defskin-${username.toLowerCase()}`;
    const cached = memCache.get(key) ?? lsGet(key);
    if (cached) {
      memCache.set(key, cached);
      setDefSkin(cached);
      return;
    }
    let live = true;
    invoke<string>('default_skin_dataurl', { username, uuid: uuid ?? null })
      .then((url) => {
        if (!live) return;
        memCache.set(key, url);
        lsSet(key, url);
        setDefSkin(url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [skinUrl, username, uuid]);

  const src = skinUrl || defSkin;
  if (!src) {
    return (
      <div
        className="rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-md shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>
          {username.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }
  return <SkinFace src={src} alt={username} size={size} />;
}
