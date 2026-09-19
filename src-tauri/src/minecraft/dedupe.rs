use std::path::{Path, PathBuf};

/// Detecta mods duplicados (mismo modId) y pone en cuarentena los viejos
/// renombrándolos a `<nombre>.duplicado`: reversible, nunca se borra nada.
/// Los duplicados son la causa más común del "código 1" al arrancar Forge.
/// Devuelve la lista de archivos puestos en cuarentena.
pub fn quarantine_duplicate_mods(instance_dir: &PathBuf) -> Vec<String> {
    let mods_dir = instance_dir.join("mods");
    let mut by_id: std::collections::HashMap<String, Vec<(PathBuf, String)>> =
        std::collections::HashMap::new();

    if let Ok(rd) = std::fs::read_dir(&mods_dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            let is_jar = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("jar"))
                .unwrap_or(false);
            // Solo .jar exactos: ni .jar.disabled ni .duplicado.
            if !is_jar || !p.is_file() {
                continue;
            }
            if let Some((mod_id, version)) = read_mod_identity(&p) {
                by_id.entry(mod_id).or_default().push((p, version));
            }
        }
    }

    let mut quarantined = Vec::new();
    for (_mod_id, mut files) in by_id {
        if files.len() < 2 {
            continue;
        }
        // Mayor versión primero; se conserva el primero.
        files.sort_by(|a, b| compare_versions(&b.1, &a.1));
        for (path, _) in files.iter().skip(1) {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let dest = mods_dir.join(format!("{}.duplicado", name));
            if std::fs::rename(path, &dest).is_ok() {
                quarantined.push(format!("{}.duplicado", name));
            }
        }
    }
    quarantined
}

/// Lee (modId, versión) de un jar: fabric.mod.json o mods.toml/neoforge.
fn read_mod_identity(jar: &Path) -> Option<(String, String)> {
    let file = std::fs::File::open(jar).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;

    if let Ok(mut f) = zip.by_name("fabric.mod.json") {
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).ok()?;
        let v: serde_json::Value = serde_json::from_str(&s).ok()?;
        let id = v.get("id")?.as_str()?.to_string();
        let ver = v.get("version")?.as_str()?.to_string();
        return Some((id, ver));
    }

    for name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        if let Ok(mut f) = zip.by_name(name) {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut f, &mut s).ok()?;
            if let Some(id) = parse_mods_toml(&s) {
                return Some(id);
            }
        }
    }
    None
}

/// Primer [[mods]] de un mods.toml: (modId, version).
fn parse_mods_toml(s: &str) -> Option<(String, String)> {
    let mut in_mods = false;
    let mut id: Option<String> = None;
    let mut ver: Option<String> = None;
    for line in s.lines() {
        let t = line.trim();
        if t.starts_with("[[") {
            if id.is_some() {
                break;
            }
            in_mods = t == "[[mods]]";
            continue;
        }
        if in_mods {
            if let Some(v) = toml_str(t, "modId") {
                id = Some(v);
            }
            if let Some(v) = toml_str(t, "version") {
                ver = Some(v);
            }
            if id.is_some() && ver.is_some() {
                break;
            }
        }
    }
    Some((id?, ver.unwrap_or_default()))
}

fn toml_str(line: &str, key: &str) -> Option<String> {
    let mut parts = line.splitn(2, '=');
    if parts.next()?.trim() != key {
        return None;
    }
    let v = parts
        .next()?
        .split('#')
        .next()?
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Compara versiones tipo "15.59.0.212" por tramos numéricos.
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let norm = |s: &str| {
        s.split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|p| !p.is_empty())
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
    };
    let (pa, pb) = (norm(a), norm(b));
    for (x, y) in pa.iter().zip(pb.iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            _ => x.cmp(y),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    pa.len().cmp(&pb.len())
}
