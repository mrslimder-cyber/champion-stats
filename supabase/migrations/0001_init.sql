-- Esquema inicial para champion-stats (LEC y, a futuro, otras ligas)
-- Fuente de verdad: Leaguepedia (lol.fandom.com), vía su Cargo API.
-- (Este fichero refleja el esquema TAL CUAL quedó aplicado en el proyecto Supabase
--  "champion-stats" — dmpupsitnpogrtyanmxh — tras la migración inicial.)

create table if not exists teams (
  id text primary key,               -- slug estable, ej. "g2-esports"
  name text not null,                -- nombre "bonito", ej. "G2 Esports"
  league text not null,               -- ej. "LEC"
  leaguepedia_page text                -- nombre de la página del equipo en Leaguepedia (para depurar/casar datos)
);

create table if not exists players (
  id text primary key,               -- slug estable, ej. "caps"
  name text not null,                 -- nombre competitivo mostrado, ej. "Caps"
  team_id text references teams(id),
  role text not null check (role in ('top','jungle','mid','adc','support')),
  leaguepedia_id text unique           -- "Link"/página del jugador en Leaguepedia: identificador
                                        -- ESTABLE aunque el jugador cambie de equipo o de alias in-game
);

create table if not exists games (
  id text primary key,               -- GameId de Leaguepedia (identificador único de partida)
  league text not null,
  split text not null,                -- ej. "2026-summer"
  match_date date not null,
  patch text,
  team_blue_id text references teams(id),
  team_red_id text references teams(id),
  winner_team_id text references teams(id),
  scraped_at timestamptz not null default now()
);
create index if not exists games_league_split_date_idx on games (league, split, match_date desc);

create table if not exists player_game_stats (
  id bigint generated always as identity primary key,
  game_id text not null references games(id) on delete cascade,
  player_id text not null references players(id),
  team_id text references teams(id),
  champion text not null,
  win boolean not null,
  kills int,
  deaths int,
  assists int,
  gold_diff_15 int                     -- null si Leaguepedia no lo tenía calculado para esa partida
);
create index if not exists pgs_player_champion_idx on player_game_stats (player_id, champion);

create table if not exists bans (
  id bigint generated always as identity primary key,
  game_id text not null references games(id) on delete cascade,
  team_id text references teams(id),
  champion text not null,
  ban_order int
);

-- Control incremental: una fila por (league, split) con la última fecha/partida
-- ya sincronizada, para que las ejecuciones siguientes solo pidan partidas nuevas.
create table if not exists scrape_state (
  league text not null,
  split text not null,
  last_scraped_date date,
  last_game_id text,
  updated_at timestamptz not null default now(),
  primary key (league, split)
);

alter table teams enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table player_game_stats enable row level security;
alter table bans enable row level security;
alter table scrape_state enable row level security;
