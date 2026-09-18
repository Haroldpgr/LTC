// Genera una actualización publicable del launcher:
//  1. Compila el instalador (tauri build)
//  2. Localiza el .exe NSIS generado
//  3. Escribe update.json junto al instalador (el admin lo sube a su hosting)
//
// Uso:
//   npm run publish:update -- "Notas de la versión (qué trae de nuevo)"
//
// Después sube el .exe y el update.json a la MISMA carpeta de tu hosting
// y pega la URL del update.json en Panel Admin > Info de update.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf-8'));
const version = tauriConf.version || tauriConf.package?.version || '1.0.0';
const notes = process.argv.slice(2).join(' ').trim() || `Actualización v${version}`;

console.log(`[publish-update] Compilando instalador v${version}...`);
execSync('npx tauri build', { cwd: root, stdio: 'inherit', shell: true });

const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
if (!existsSync(nsisDir)) {
  console.error('[publish-update] No se encontró la carpeta bundle/nsis. ¿Falló la compilación?');
  process.exit(1);
}
const exes = readdirSync(nsisDir)
  .filter((f) => f.endsWith('.exe'))
  .map((f) => ({ f, t: statSync(join(nsisDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
if (exes.length === 0) {
  console.error('[publish-update] No se generó ningún .exe en bundle/nsis.');
  process.exit(1);
}
const installer = exes[0].f;

const updateJson = {
  version,
  notes,
  installerUrl: `https://TU-HOST.com/ltc/${installer}`,
};
writeFileSync(join(nsisDir, 'update.json'), JSON.stringify(updateJson, null, 2));

console.log('');
console.log('[publish-update] Listo:');
console.log(`  Instalador: ${join(nsisDir, installer)}`);
console.log(`  JSON:       ${join(nsisDir, 'update.json')}`);
console.log('');
console.log('  SIN HOSTING: usa GitHub Releases (gratis, sin tarjeta):');
console.log('    1. Crea cuenta en https://github.com y un repositorio (ej. "ltc-updates").');
console.log('    2. En el repo: Releases > Create a new release > tag v' + version + ' > sube el .exe.');
console.log('    3. Edita update.json: pon en "installerUrl" la URL del .exe, p. ej.');
console.log(`       https://github.com/TU-USUARIO/ltc-updates/releases/download/v${version}/${installer}`);
console.log('    4. Sube también el update.json al mismo release (o a la rama con el mismo nombre).');
console.log('    5. En el launcher (admin, Info de update) pega la URL pública del update.json y guárdala.');
console.log('  (Sirve igual para los zips de mods: súbelos a un release y comparte el enlace como Fuente de mods.)');

// Intento opcional con GitHub CLI si está instalada y autenticada
try {
  execSync('gh --version', { stdio: 'ignore', shell: true });
  console.log('');
  console.log('[publish-update] Detectado `gh`. Para publicar por terminal:');
  console.log(`  gh release create v${version} "${join(nsisDir, installer)}" "${join(nsisDir, 'update.json')}" --title "v${version}" --notes "${notes.replace(/"/g, "'")}"`);
} catch {
  // gh no disponible: solo quedan los pasos manuales de arriba
}
