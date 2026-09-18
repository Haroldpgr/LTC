// Publica una actualización del launcher en un GitHub Release:
//  1. (Opcional) sube la versión con --version=X.Y.Z en los 3 archivos
//  2. Compila el instalador (tauri build)
//  3. Escribe update.json con la URL final del instalador
//  4. Si hay `gh` autenticado, crea el release y sube ambos archivos solo
//
// Uso:
//   npm run publish:update -- "Notas de la versión"
//   npm run publish:update -- --version=1.1.0 "Notas de la versión"
//
// Después pega la URL del update.json en el launcher (admin, Info de update):
//   https://github.com/TU-USUARIO/TU-REPO/releases/download/vX.Y.Z/update.json

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, shell: true, ...opts });
const shOut = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, shell: true, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

// --- Flags: --version=X.Y.Z ---
let rawArgs = process.argv.slice(2);
let bumpVersion = null;
rawArgs = rawArgs.filter((a) => {
  const m = a.match(/^--version=(.+)$/);
  if (m) {
    bumpVersion = m[1].trim();
    return false;
  }
  return true;
});
const notes = rawArgs.join(' ').trim();

// --- Subir versión en package.json, tauri.conf.json y Cargo.toml ---
function bumpFiles(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`[publish-update] Versión inválida: "${version}". Usa formato X.Y.Z (ej. 1.1.0).`);
    process.exit(1);
  }
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const confPath = join(root, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(readFileSync(confPath, 'utf-8'));
  conf.version = version;
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

  const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
  const cargo = readFileSync(cargoPath, 'utf-8').replace(
    /^version\s*=\s*".*"$/m,
    `version = "${version}"`
  );
  writeFileSync(cargoPath, cargo);
  console.log(`[publish-update] Versión subida a ${version} (package.json, tauri.conf.json, Cargo.toml).`);
}
if (bumpVersion) bumpFiles(bumpVersion);

const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf-8'));
const version = tauriConf.version || '1.0.0';
const finalNotes = notes || `Actualización v${version}`;
const tag = `v${version}`;

// --- Repo destino (del remote origin) ---
let repoSlug = null;
try {
  const remote = shOut('git remote get-url origin');
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (m) repoSlug = m[1];
} catch { /* sin remote: modo manual */ }

console.log(`[publish-update] Compilando instalador v${version}...`);
if (process.platform === 'win32') {
  // En Windows usa el wrapper que firma los .exe bloqueados por WDAC (error 4551)
  execSync('powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1', { cwd: root, stdio: 'inherit', shell: true });
} else {
  execSync('npx tauri build', { cwd: root, stdio: 'inherit', shell: true });
}

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

// --- update.json con la URL final (predecible en Releases) ---
const installerUrl = repoSlug
  ? `https://github.com/${repoSlug}/releases/download/${tag}/${installer}`
  : `https://TU-HOST.com/ltc/${installer}`;
const updateJson = { version, notes: finalNotes, installerUrl };
const updatePath = join(nsisDir, 'update.json');
writeFileSync(updatePath, JSON.stringify(updateJson, null, 2));

console.log('');
console.log('[publish-update] Archivos listos:');
console.log(`  Instalador: ${join(nsisDir, installer)}`);
console.log(`  JSON:       ${updatePath}`);
console.log(`  Mensaje:    ${finalNotes}`);

// --- Subida automática con gh (si está instalado y autenticado) ---
let uploaded = false;
try {
  execFileSync('gh', ['--version'], { stdio: 'ignore' });
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  console.log('');
  console.log(`[publish-update] Subiendo a GitHub (${repoSlug ?? 'repo local'}) con tag ${tag}...`);
  try {
    execFileSync('gh', ['release', 'view', tag, ...(repoSlug ? ['--repo', repoSlug] : [])], { stdio: 'ignore' });
    console.log(`[publish-update] El release ${tag} ya existe: adjuntando archivos...`);
    execFileSync(
      'gh',
      ['release', 'upload', tag, join(nsisDir, installer), updatePath, '--clobber', ...(repoSlug ? ['--repo', repoSlug] : [])],
      { stdio: 'inherit' }
    );
  } catch {
    console.log(`[publish-update] Creando release ${tag}...`);
    const args = [
      'release', 'create', tag,
      join(nsisDir, installer), updatePath,
      '--title', `v${version}`,
      '--notes', finalNotes,
      ...(repoSlug ? ['--repo', repoSlug] : []),
    ];
    execFileSync('gh', args, { stdio: 'inherit' });
  }
  uploaded = true;
  console.log('');
  console.log('[publish-update] ✅ Subido. Pega esta URL en el launcher (admin, Info de update):');
  console.log(`  ${installerUrl.replace(`/${installer}`, '/update.json')}`);
} catch {
  // gh no disponible o sin autenticar: instrucciones manuales
}

if (!uploaded) {
  console.log('');
  console.log('[publish-update] Súbelo tú (2 min en la web):');
  console.log('  1. Abre tu repo en GitHub > Releases > "Create a new release".');
  console.log(`  2. Tag: ${tag} · Title: v${version} · pega estas notas:`);
  console.log(`     ${finalNotes}`);
  console.log('  3. Arrastra el .exe y el update.json a "Attach binaries".');
  console.log('  4. Publish. Luego pega esta URL en el launcher (admin, Info de update):');
  console.log(`     ${installerUrl.replace(`/${installer}`, '/update.json')}`);
  console.log('  (Si instalas gh y haces `gh auth login`, este script lo sube solo la próxima vez.)');
}
