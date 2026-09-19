// Publica una actualización del launcher en un GitHub Release:
//  1. (Opcional) sube la versión con --version=X.Y.Z en los 3 archivos
//  2. Compila el instalador (tauri build)
//  3. Escribe update.json con la URL final del instalador
//  4. Sube ambos archivos al release (con token) o te dice cómo hacerlo
//
// Uso:
//   npm run publish:update -- "Notas de la versión"
//   npm run publish:update -- --version=1.1.0 "Notas de la versión"
//   GITHUB_TOKEN=xxx npm run publish:update -- --version=1.1.0 "Notas"
//   npm run publish:update -- --skip-build  (reintenta solo la subida)
//   (sin versión ni notas, te las pregunta)
//
// El token también lo pone solo el botón "Compilar y subir release"
// del Panel admin. Sin token intenta con `gh` autenticado, y si no,
// te deja los archivos + instrucciones manuales.
//
// Después pega la URL del update.json en el launcher (admin, Info de update):
//   https://github.com/TU-USUARIO/TU-REPO/releases/download/vX.Y.Z/update.json

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, shell: true, ...opts });
const shOut = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, shell: true, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

// --- Flags: --version=X.Y.Z --api-token=... --skip-build ---
let rawArgs = process.argv.slice(2);
let bumpVersion = null;
let skipBuild = false;
let apiToken = process.env.GITHUB_TOKEN || null;
rawArgs = rawArgs.filter((a) => {
  let m = a.match(/^--version=(.+)$/);
  if (m) {
    bumpVersion = m[1].trim();
    return false;
  }
  m = a.match(/^--api-token=(.+)$/);
  if (m) {
    apiToken = m[1].trim();
    return false;
  }
  if (a === '--skip-build') {
    skipBuild = true;
    return false;
  }
  return true;
});
let notes = rawArgs.join(' ').trim();

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

if (!bumpVersion && process.stdin.isTTY) {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version || '1.0.0';
  const p = current.split('.').map(Number);
  const suggestion = `${p[0] || 1}.${p[1] || 0}.${(p[2] ?? 0) + 1}`;
  const ans = await ask(`Versión a publicar [${suggestion}]: `);
  bumpVersion = ans || suggestion;
}
if (!notes && process.stdin.isTTY) {
  const ans = await ask('Mensaje del release (notas para los usuarios): ');
  notes = ans;
}

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

// Lock anti doble ejecución (el botón del panel puede pulsarse dos veces).
// Si el proceso dueño murió (ventana matada a mitad), el lock se considera
// caducado y se sigue: se comprueba el PID guardado.
const lockPath = join(root, 'src-tauri', 'target', 'release', '.publish-lock');
function lockAlive() {
  try {
    if (!existsSync(lockPath)) return false;
    const age = Date.now() - statSync(lockPath).mtimeMs;
    let alive = true;
    try {
      const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
      if (pid) process.kill(pid, 0);
      else alive = false;
    } catch { alive = false; }
    return alive && age < 30 * 60 * 1000;
  } catch { return false; }
}
if (lockAlive()) {
  console.error('[publish-update] Ya hay una publicación en curso. Espera a que termine.');
  process.exit(1);
}
try { writeFileSync(lockPath, String(process.pid)); } catch { /* sin lock: se sigue */ }
const releaseLock = () => { try { rmSync(lockPath, { force: true }); } catch {} };
process.on('exit', releaseLock);

// --- Repo destino (del remote origin) ---
let repoSlug = null;
try {
  const remote = shOut('git remote get-url origin');
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (m) repoSlug = m[1];
} catch { /* sin remote: modo manual */ }

console.log(`[publish-update] Compilando instalador v${version}...`);
if (skipBuild) {
  console.log('[publish-update] --skip-build: se reutiliza el instalador ya compilado.');
} else if (process.platform === 'win32') {
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
let installer = exes[0].f;

// Nombre sin espacios ni caracteres raros: los enlaces de Releases
// con espacios fallan al descargar desde el launcher.
const safeInstaller = installer.replace(/[^\w.\-]+/g, '-');
if (safeInstaller !== installer) {
  copyFileSync(join(nsisDir, installer), join(nsisDir, safeInstaller));
  installer = safeInstaller;
}

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

// --- Subida automática por API de GitHub (con token) ---
async function apiUpload() {
  const H = {
    Authorization: `Bearer ${apiToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LTC-Launcher',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const fail = async (res, what) => {
    const txt = (await res.text()).slice(0, 200);
    throw new Error(`${what}: HTTP ${res.status} ${txt}`);
  };
  let rel;
  const getRes = await fetch(`https://api.github.com/repos/${repoSlug}/releases/tags/${tag}`, { headers: H });
  if (getRes.status === 404) {
    console.log(`[publish-update] Creando release ${tag}...`);
    const cr = await fetch(`https://api.github.com/repos/${repoSlug}/releases`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: `v${version}`, body: finalNotes, draft: false, prerelease: false }),
    });
    if (cr.status === 401 || cr.status === 403) throw new Error('Token inválido o sin permisos (necesita scope repo o Contents: read+write).');
    if (!cr.ok) await fail(cr, 'crear release');
    rel = await cr.json();
  } else if (getRes.status === 401 || getRes.status === 403) {
    throw new Error('Token inválido o sin permisos (necesita scope repo o Contents: read+write).');
  } else if (!getRes.ok) {
    await fail(getRes, 'consultar release');
  } else {
    rel = await getRes.json();
    console.log(`[publish-update] El release ${tag} ya existe: reemplazando archivos...`);
  }
  for (const asset of rel.assets || []) {
    if (asset.name === installer || asset.name === 'update.json') {
      await fetch(`https://api.github.com/repos/${repoSlug}/releases/assets/${asset.id}`, { method: 'DELETE', headers: H });
    }
  }
  const baseUpload = rel.upload_url.replace('{?name,label}', '');
  for (const fname of [installer, 'update.json']) {
    const buf = readFileSync(join(nsisDir, fname));
    const up = await fetch(`${baseUpload}?name=${encodeURIComponent(fname)}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
      body: buf,
    });
    if (!up.ok) await fail(up, `subir ${fname}`);
    console.log(`[publish-update] Subido: ${fname}`);
  }
}

let uploaded = false;
if (apiToken && repoSlug) {
  try {
    await apiUpload();
    uploaded = true;
    // Dejar la subida de versión commiteada en la rama actual
    if (bumpVersion) {
      try {
        sh('git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json');
        sh(`git commit -m "v${version}"`);
        try { sh(`git push origin ${shOut('git branch --show-current')}`); } catch { /* push manual */ }
      } catch { /* commit manual */ }
    }
    console.log('');
    console.log('[publish-update] Subido. Pega esta URL en el launcher (admin, Info de update):');
    console.log(`  ${installerUrl.replace(`/${installer}`, '/update.json')}`);
  } catch (e) {
    console.error(`[publish-update] ${e.message || e}`);
    process.exit(1);
  }
} else if (apiToken && !repoSlug) {
  console.error('[publish-update] Hay token pero no se detectó el repo (remote origin). Súbelo manual:');
}

if (!uploaded && !apiToken) {
// --- Subida automática con gh (si está instalado y autenticado) ---
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
  console.log('  (Con token —botón del Panel admin o GITHUB_TOKEN— este script lo sube solo.)');
}
} // fin if (!uploaded && !apiToken)
