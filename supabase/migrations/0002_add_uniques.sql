-- Únicas para poder hacer upsert/borrado idempotente por partida.
alter table player_game_stats
  add constraint player_game_stats_game_player_uniq unique (game_id, player_id);

alter table bans
  add constraint bans_game_team_champ_uniq unique (game_id, team_id, champion);
