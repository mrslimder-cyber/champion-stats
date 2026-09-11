// Sincroniza partidas (ScoreboardGames) y estadísticas por jugador (ScoreboardPlayers)
// de Leaguepedia -> Supabase, para un (LEAGUE, SPLIT, OVERVIEW_PAGE) dado.
//
// - Primera ejecución para un split: backfill completo (todas las partidas ya jugadas).
// - Ejecuciones siguientes: solo pide partidas con fecha posterior a la última
//   sincronizada (tabla scrape_state), así que solo trae 1-2 partidas nuevas.
//
// Variables de entorno requeridas:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   LEAGUE            ej. "LEC"
//   SPLIT             ej. "2026-summer"   (nuestro id interno, usado también en el JSON)
//   OVERVIEW_PAGE     ej. "LEC/2026 Season/Summer Season"  (página EXACTA del torneo en Leaguepedia)

import { createClient } from "@supabase/supabase-js";
import { cargoFields, cargoQueryAll, pickField } from "./lib/cargo.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEAGUE = process.env.LEAGUE || "LEC";
const SPLIT = process.env.SPLIT || "2026-summer";
const OVERVIEW_PAGE = process.env.OVERVIEW_PAGE;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}
if (!OVERVIEW_PAGE) {
  throw new Error(
    'Falta OVERVIEW_PAGE. Es el nombre EXACTO de la página del torneo en Leaguepedia, ' +
      'ej. "LEC/2026 Season/Summer Season" (mira la URL de lol.fandom.com/wiki/... y cambia "_" por " ").'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ROLE_MAP = {
  Top: "top",
  Jungle: "jungle",
  Mid: "mid",
  Middle: "mid",
  Bot: "adc",
  ADC: "adc",
  Bottom: "adc",
  Support: "support",
};

function slug(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function toDateOnly(v) {
  // Cargo devuelve "DateTime_UTC" tipo "2026-08-01 18:05:00" -> nos quedamos con la fecha
  return String(v).slice(0, 10);
}

async function ensureTeam(name, league) {
  if (!name) return null;
  const id = slug(name);
  const { error } = await supabase
    .from("teams")
    .upsert({ id, name, league, leaguepedia_page: name }, { onConflict: "id" });
  if (error) throw error;
  return id;
}

async function main() {
  console.log(`\n=== Sync ${LEAGUE} ${SPLIT} — ${OVERVIEW_PAGE} ===`);

  // 1. Descubrir campos reales de las tablas Cargo, en vez de asumirlos de memoria.
  const [gameFields, playerFields] = await Promise.all([
    cargoFields("ScoreboardGames"),
    cargoFields("ScoreboardPlayers"),
  ]);

  const F_GAME_ID = pickField(gameFields, ["GameId", "RiotPlatformGameId"], { required: true, label: "GameId" });
  const F_DATE = pickField(gameFields, ["DateTime UTC", "DateTime_UTC"], { required: true, label: "DateTime_UTC" });
  const F_TEAM1 = pickField(gameFields, ["Team1"], { required: true, label: "Team1" });
  const F_TEAM2 = pickField(gameFields, ["Team2"], { required: true, label: "Team2" });
  const F_WINNER = pickField(gameFields, ["Winner"], { required: true, label: "Winner" });
  const F_PATCH = pickField(gameFields, ["Patch"]);
  const F_OVERVIEW = pickField(gameFields, ["OverviewPage"], { required: true, label: "OverviewPage" });

  const F_P_GAMEID = pickField(playerFields, ["GameId"], { required: true, label: "GameId (ScoreboardPlayers)" });
  const F_P_LINK = pickField(playerFields, ["Link", "Player", "IngameName"], { required: true, label: "Link/jugador" });
  const F_P_TEAM = pickField(playerFields, ["Team"], { required: true, label: "Team (ScoreboardPlayers)" });
  const F_P_ROLE = pickField(playerFields, ["Role"], { required: true, label: "Role" });
  const F_P_CHAMP = pickField(playerFields, ["Champion"], { required: true, label: "Champion" });
  const F_P_WIN = pickField(playerFields, ["PlayerWin"], { required: true, label: "PlayerWin" });
  const F_P_K = pickField(playerFields, ["Kills"]);
  const F_P_D = pickField(playerFields, ["Deaths"]);
  const F_P_A = pickField(playerFields, ["Assists"]);
  const F_P_GD15 = pickField(playerFields, ["GoldDiffAt15", "GoldDiff@15", "GoldDiff15", "Gold@15Diff"]);
  const F_P_OVERVIEW = pickField(playerFields, ["OverviewPage"], { required: true, label: "OverviewPage (ScoreboardPlayers)" });

  if (!F_P_GD15) {
    console.warn(
      "  (aviso: no encuentro un campo de diferencia de oro a los 15' en ScoreboardPlayers — se guardará como null)"
    );
  }

  // 2. ¿Backfill o incremental? Miramos scrape_state para este (league, split).
  const { data: state, error: stateErr } = await supabase
    .from("scrape_state")
    .select("last_scraped_date, last_game_id")
    .eq("league", LEAGUE)
    .eq("split", SPLIT)
    .maybeSingle();
  if (stateErr) throw stateErr;

  let where = `ScoreboardGames.${F_OVERVIEW}="${OVERVIEW_PAGE}"`;
  if (state?.last_scraped_date) {
    where += ` AND ScoreboardGames.${F_DATE} > "${state.last_scraped_date} 23:59:59"`;
    console.log(`Incremental: pidiendo partidas posteriores a ${state.last_scraped_date}`);
  } else {
    console.log("Sin estado previo para este split: backfill completo.");
  }

  // 3. Traer partidas del torneo (paginado automáticamente).
  const games = await cargoQueryAll({
    tables: "ScoreboardGames",
    fields: [F_GAME_ID, F_DATE, F_TEAM1, F_TEAM2, F_WINNER, F_PATCH].filter(Boolean).join(","),
    where,
    orderBy: `ScoreboardGames.${F_DATE} ASC`,
  });

  console.log(`${games.length} partida(s) nueva(s) encontradas en Leaguepedia.`);
  if (games.length === 0) {
    console.log("Nada que sincronizar. Fin.");
    return;
  }

  let lastDate = state?.last_scraped_date || null;
  let lastGameId = state?.last_game_id || null;

  console.log("Descargando ScoreboardPlayers de todo el torneo (una sola pasada)...");
  const allPlayers = await cargoQueryAll({
    tables: "ScoreboardPlayers",
    fields: [F_P_GAMEID, F_P_LINK, F_P_TEAM, F_P_ROLE, F_P_CHAMP, F_P_WIN, F_P_K, F_P_D, F_P_A, F_P_GD15]
      .filter(Boolean)
      .join(","),
    where: `ScoreboardPlayers.${F_P_OVERVIEW}="${OVERVIEW_PAGE}"`,
  });
  const playersByGameId = new Map();
  for (const p of allPlayers) {
    const gid = String(p[F_P_GAMEID]);
    if (!playersByGameId.has(gid)) playersByGameId.set(gid, []);
    playersByGameId.get(gid).push(p);
  }
  console.log(`${allPlayers.length} filas de jugadores para ${playersByGameId.size} partidas.`);

  for (const g of games) {
    const gameId = String(g[F_GAME_ID]);
    const team1 = g[F_TEAM1];
    const team2 = g[F_TEAM2];
    const winnerRaw = String(g[F_WINNER] ?? "").trim();
    const winnerTeam = winnerRaw === "1" ? team1 : winnerRaw === "2" ? team2 : null;
    const matchDate = toDateOnly(g[F_DATE]);

    const team1Id = await ensureTeam(team1, LEAGUE);
    const team2Id = await ensureTeam(team2, LEAGUE);
    const winnerId = winnerTeam ? slug(winnerTeam) : null;

    const { error: gameErr } = await supabase.from("games").upsert(
      {
        id: gameId,
        league: LEAGUE,
        split: SPLIT,
        match_date: matchDate,
        patch: F_PATCH ? g[F_PATCH] : null,
        team_blue_id: team1Id,
        team_red_id: team2Id,
        winner_team_id: winnerId,
      },
      { onConflict: "id" }
    );
    if (gameErr) throw gameErr;

   
    // 4. Jugadores de esa partida (ya descargados en bloque, sin petición extra).
    const players = playersByGameId.get(gameId) || [];

    // Borramos y reinsertamos las filas de esta partida: evita duplicados sin
    // depender de que exista un índice único exacto, y es idempotente si se
    // relanza la sync para las mismas partidas.
    await supabase.from("player_game_stats").delete().eq("game_id", gameId);

    const rows = [];
    for (const p of players) {
      const playerName = p[F_P_LINK];
      if (!playerName) continue;
      const teamName = p[F_P_TEAM];
      const roleRaw = p[F_P_ROLE];
      const role = ROLE_MAP[roleRaw] || null;
      const playerId = slug(playerName);
      const teamId = teamName ? await ensureTeam(teamName, LEAGUE) : null;

      if (!role) {
        console.warn(`  (aviso: rol desconocido "${roleRaw}" para ${playerName} en partida ${gameId}, se omite el jugador)`);
        continue;
      }

      await supabase.from("players").upsert(
        { id: playerId, name: playerName, team_id: teamId, role, leaguepedia_id: playerName },
        { onConflict: "id" }
      );

      rows.push({
        game_id: gameId,
        player_id: playerId,
        team_id: teamId,
        champion: p[F_P_CHAMP],
        win: String(p[F_P_WIN]).toLowerCase() === "yes",
        kills: F_P_K ? toIntOrNull(p[F_P_K]) : null,
        deaths: F_P_D ? toIntOrNull(p[F_P_D]) : null,
        assists: F_P_A ? toIntOrNull(p[F_P_A]) : null,
        gold_diff_15: F_P_GD15 ? toIntOrNull(p[F_P_GD15]) : null,
      });
    }

    if (rows.length) {
      const { error: statsErr } = await supabase.from("player_game_stats").insert(rows);
      if (statsErr) throw statsErr;
    }

    console.log(`  ✓ ${gameId} (${matchDate}) ${team1} vs ${team2} — ${rows.length} jugadores`);

    if (!lastDate || matchDate >= lastDate) {
      lastDate = matchDate;
      lastGameId = gameId;
    }
  }

  // 5. Actualizamos el puntero incremental.
  const { error: upsertStateErr } = await supabase.from("scrape_state").upsert(
    {
      league: LEAGUE,
      split: SPLIT,
      last_scraped_date: lastDate,
      last_game_id: lastGameId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league,split" }
  );
  if (upsertStateErr) throw upsertStateErr;

  console.log(`Sync completada. Último dato: ${lastDate} (game ${lastGameId}).`);
}

main().catch((err) => {
  console.error("ERROR en sync.mjs:", err);
  process.exit(1);
});
