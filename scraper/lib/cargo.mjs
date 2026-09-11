// Cliente mínimo para la Cargo API de Leaguepedia (lol.fandom.com).
// No hay API key: es de lectura pública, pero hay que ser buen ciudadano con el
// rate limit (Leaguepedia pide un User-Agent identificable y no abusar).

const API = "https://lol.fandom.com/api.php";
const USER_AGENT =
  process.env.CARGO_USER_AGENT ||
  "champion-stats-scraper/1.0 (repo: mrslimder-cyber/champion-stats; uso personal, no comercial)";
const MIN_GAP_MS = Number(process.env.CARGO_MIN_GAP_MS || 1200); // ~1 petición/seg

let lastCallAt = 0;
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function rateLimit() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function cargoFetch(params) {
  await rateLimit();
  const url = `${API}?${new URLSearchParams({
    ...params,
    formatversion: "2", // fuerza arrays JSON "de verdad" (v1 puede serializar listas como objetos {"0":..,"1":..})
  }).toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cargo API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Cargo API error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

// Normaliza un valor que "debería" ser array: si la API devolvió un objeto
// con claves numéricas en vez de un array real, lo convierte igualmente.
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

/**
 * Devuelve la lista real de nombres de campo de una tabla Cargo.
 * Se usa para no asumir de memoria nombres de columnas que Leaguepedia
 * pueda haber cambiado o que yo pueda recordar mal.
 */
export async function cargoFields(table) {
  const data = await cargoFetch({ action: "cargofields", table, format: "json" });
  return asArray(data.cargofields).map((f) => f.field);
}
/**
 * Dada una lista de campos "descubiertos" (cargoFields) y una lista de nombres
 * candidatos en orden de preferencia, devuelve el primero que exista de verdad.
 * Lanza si ninguno existe y `required` es true.
 */
export function pickField(discovered, candidates, { required = false, label = "" } = {}) {
  for (const c of candidates) {
    if (discovered.includes(c)) return c;
  }
  if (required) {
    throw new Error(
      `No se encontró ningún campo esperado para "${label}". Probados: ${candidates.join(
        ", "
      )}. Campos disponibles: ${discovered.join(", ")}`
    );
  }
  return null;
}

/**
 * Cargoquery con paginación automática (Cargo limita a 500 filas por petición).
 */
export async function cargoQueryAll({ tables, fields, where = "", joinOn = "", orderBy = "", limit = 500 }) {
  let offset = 0;
  const all = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = {
      action: "cargoquery",
      format: "json",
      tables,
      fields,
      limit: String(limit),
      offset: String(offset),
    };
    if (where) params.where = where;
    if (joinOn) params.join_on = joinOn;
    if (orderBy) params.order_by = orderBy;

    const data = await cargoFetch(params);
    const rows = asArray(data.cargoquery).map((r) => r.title);
    all.push(...rows);

    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}
