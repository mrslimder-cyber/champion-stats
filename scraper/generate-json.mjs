// Lee Supabase y escribe data/champion_stats/<league>/<split>.json con el esquema
// por-jugador documentado en data/champion_stats/README-estadisticas-campeones.md
// (teams[].players[].champions[] con games/wins/losses/winrate/goldDiff15Avg),
// más roleTopPicks. También mantiene actualizado index.json.
//
// Variables de entorno:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   LEAGUE   ej. "LEC"
//   SPLIT    ej. "2026-summer"
//   OUT_DIR  por defecto "data/champion_stats"

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEAGUE = process.env.LEAGUE || "LEC";
const SPLIT = process.env.SPLIT || "2026-summer";
const OUT_DIR = process.env.OUT_DIR || "data/champion_stats";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id,name")
    .eq("league", LEAGUE);
  if (teamsErr) throw teamsErr;

  const { data: players, error: playersErr } = await supabase
    .from("players")
    .select("id,name,team_id,role");
  if (playersErr) throw playersErr;

  // Traemos game_id + split/league vía join con games para filtrar solo este split,
  // y todas las filas de player_game_stats de esas partidas.
  const { data: gamesInSplit, error: gamesErr } = await supabase
    .from("games")
    .select("id")
    .eq("league", LEAGUE)
    .eq("split", SPLIT);
  if (gamesErr) throw gamesErr;
  const gameIds = (gamesInSplit || []).map((g) => g.id);

  let stats = [];
  if (gameIds.length) {
    // Supabase limita el tamaño del `in()`; troceamos por si el split crece mucho.
    const chunkSize = 200;
    for (let i = 0; i < gameIds.length; i += chunkSize) {
      const chunk = gameIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("player_game_stats")
        .select("player_id,champion,win,gold_diff_15")
        .in("game_id", chunk);
      if (error) throw error;
      stats.push(...data);
    }
  }

  console.log(`${teams.length} equipos, ${players.length} jugadores, ${stats.length} líneas de stats (${SPLIT}).`);

  // Agregamos por (player_id, champion).
  const byPlayerChamp = new Map();
  for (const row of stats) {
    const key = `${row.player_id}::${row.champion}`;
    if (!byPlayerChamp.has(key)) {
      byPlayerChamp.set(key, { player_id: row.player_id, champion: row.champion, games: 0, wins: 0, losses: 0, gdSum: 0, gdCount: 0 });
    }
    const e = byPlayerChamp.get(key);
    e.games += 1;
    if (row.win) e.wins += 1;
    else e.losses += 1;
    if (row.gold_diff_15 !== null && row.gold_diff_15 !== undefined) {
      e.gdSum += row.gold_diff_15;
      e.gdCount += 1;
    }
  }

  const champsByPlayer = new Map();
  for (const e of byPlayerChamp.values()) {
    if (!champsByPlayer.has(e.player_id)) champsByPlayer.set(e.player_id, []);
    champsByPlayer.get(e.player_id).push({
      champion: e.champion,
      games: e.games,
      wins: e.wins,
      losses: e.losses,
      winrate: e.games ? Number((e.wins / e.games).toFixed(2)) : 0,
      goldDiff15Avg: e.gdCount ? Math.round(e.gdSum / e.gdCount) : null,
    });
  }
  for (const list of champsByPlayer.values()) list.sort((a, b) => b.games - a.games);

  const playersByTeam = new Map();
  for (const p of players) {
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id).push(p);
  }

  const teamsOut = teams.map((t) => {
    const teamPlayers = (playersByTeam.get(t.id) || []).map((p) => {
      const champions = champsByPlayer.get(p.id) || [];
      const gamesPlayed = champions.reduce((sum, c) => sum + c.games, 0);
      return { id: p.id, name: p.name, role: p.role, gamesPlayed, champions };
    });
    // Solo incluimos jugadores con datos en este split.
    return { id: t.id, name: t.name, players: teamPlayers.filter((p) => p.gamesPlayed > 0) };
  });

  // roleTopPicks: picks totales por campeón y rol, sumando todos los equipos.
  const pickCounts = { top: {}, jungle: {}, mid: {}, adc: {}, support: {} };
  for (const t of teamsOut) {
    for (const p of t.players) {
      if (!p.role || !pickCounts[p.role]) continue;
      for (const c of p.champions) {
        pickCounts[p.role][c.champion] = (pickCounts[p.role][c.champion] || 0) + c.games;
      }
    }
  }
  const roleTopPicks = {};
  for (const role of Object.keys(pickCounts)) {
    roleTopPicks[role] = Object.entries(pickCounts[role])
      .map(([champion, picks]) => ({ champion, picks }))
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 3);
  }

  const out = {
    league: LEAGUE,
    split: SPLIT,
    lastUpdated: new Date().toISOString(),
    source: "Leaguepedia (Cargo API)",
    isPlaceholder: false,
    teams: teamsOut.filter((t) => t.players.length > 0),
    roleTopPicks,
  };

  const leagueDir = path.join(OUT_DIR, LEAGUE.toLowerCase());
  await fs.mkdir(leagueDir, { recursive: true });
  const outFile = path.join(leagueDir, `${SPLIT}.json`);
  await fs.writeFile(outFile, JSON.stringify(out, null, 2) + "\n");
  console.log(`Escrito ${outFile}`);

  // Actualizar index.json (añade la liga/split si no estaban ya).
  const idxPath = path.join(OUT_DIR, "index.json");
  let idx = { leagues: [] };
  try {
    idx = JSON.parse(await fs.readFile(idxPath, "utf8"));
  } catch {
    // no existía todavía
  }
  const leagueId = LEAGUE.toLowerCase();
  let leagueEntry = idx.leagues.find((l) => l.id === leagueId);
  if (!leagueEntry) {
    leagueEntry = { id: leagueId, name: LEAGUE, splits: [] };
    idx.leagues.push(leagueEntry);
  }
  if (!leagueEntry.splits.includes(SPLIT)) leagueEntry.splits.push(SPLIT);
  await fs.writeFile(idxPath, JSON.stringify(idx, null, 2) + "\n");
  console.log(`Actualizado ${idxPath}`);
}

main().catch((err) => {
  console.error("ERROR en generate-json.mjs:", err);
  process.exit(1);
});
