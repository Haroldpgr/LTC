import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;
let channelKey = '';

/**
 * Suscripción al aviso de catálogo nuevo (tabla catalog_state).
 * Al publicarse algo, llama a onCatalog: el launcher recarga instancias
 * y mods al instante, sin que el usuario haga nada.
 * Si ya está suscrito con las mismas credenciales, no hace nada.
 */
export function ensureRealtime(url: string, anonKey: string, onCatalog: () => void) {
  if (!url || !anonKey) return;
  const key = `${url}|${anonKey.slice(0, 12)}`;
  if (channel && channelKey === key) return;
  if (channel) {
    try {
      channel.unsubscribe();
    } catch {
      /* noop */
    }
    channel = null;
  }
  try {
    const client = createClient(url, anonKey);
    const ch = client.channel('ltc-catalog');
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_state' }, () => {
      try {
        onCatalog();
      } catch {
        /* noop */
      }
    });
    ch.subscribe();
    channel = ch;
    channelKey = key;
  } catch {
    // Sin tiempo real: el arranque ya sincroniza por su cuenta.
  }
}
