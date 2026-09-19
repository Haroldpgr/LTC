import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;
let channelKey = '';

/**
 * Suscripción a las tablas vivas (catalog_state, instances, mod_states,
 * notices). Al publicarse algo, llama a onCatalog: el launcher recarga
 * instancias, mods y avisos al instante, sin que el usuario haga nada.
 * Con debounce: varios eventos seguidos provocan una sola recarga.
 */
let debounce: ReturnType<typeof setTimeout> | null = null;
function debounced(cb: () => void) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    try {
      cb();
    } catch {
      /* noop */
    }
  }, 800);
}

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
    const ch = client.channel('ltc-live');
    const fire = () => debounced(onCatalog);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_state' }, fire);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'instances' }, fire);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'mod_states' }, fire);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, fire);
    ch.subscribe();
    channel = ch;
    channelKey = key;
  } catch {
    // Sin tiempo real: el arranque ya sincroniza por su cuenta.
  }
}
