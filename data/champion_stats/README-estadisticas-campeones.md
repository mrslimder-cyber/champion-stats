# Estadísticas de Campeones Pro — Hub por liga

Sección tipo "predicciones": un HTML autocontenido (`champion-stats.html`) que lee ficheros
JSON estáticos. No hay backend ni base de datos — igual que en predicciones, alguien (o un
script) sube un JSON nuevo y la web se actualiza sola.

## Estado actual

Todo lo de aquí es **maquetación + estructura de datos**, funcionando con datos de ejemplo.
La parte de "ir a buscar los datos reales a Leaguepedia/Oracle's Elixir y generar el JSON"
la lleva otra persona — este documento define el contrato (el formato exacto que ese
JSON tiene que tener) para que lo pueda implementar sin tener que hablar conmigo.

## Cómo funciona la navegación

1. **Vista liga**: selecciona liga + split arriba → se cargan los datos de
   `/data/champion-stats/{liga}/{split}.json` → se pintan los 5 roles con los 3 campeones
   más pickeados de cada uno (`roleTopPicks`).
2. Click en un rol → lista de todos los jugadores de esa posición en la liga, con su
   campeón más jugado como vista rápida.
3. Click en un jugador → tarjetas resumen (más pickeado, mayor winrate, menor winrate,
   mejor ventaja de oro a los 15') + tabla completa de todos sus campeones jugados.

## Dónde alojar los ficheros

```
/data/champion-stats/
  index.json                 ← qué ligas/splits existen (rellena el selector)
  lec/
    2027-winter.json         ← datos de esa liga+split
  lck/
    2027-winter.json
```

Si en el servidor real esta carpeta no cuelga de la raíz, cambia la constante
`DATA_BASE` al principio del `<script>` de `champion-stats.html`.

## Esquema de `index.json`

```json
{
  "leagues": [
    { "id": "lec", "name": "LEC", "splits": ["2027-winter"] }
  ]
}
```
- `id`: minúsculas, sin espacios, se usa en la URL del JSON de esa liga.
- `splits`: formato `AAAA-temporada` (ej. `2027-winter`, `2027-spring`). El texto que se
  muestra al usuario se genera automáticamente a partir de esto.

## Esquema de `{liga}/{split}.json`

```json
{
  "league": "LEC",
  "split": "2027-winter",
  "lastUpdated": "2027-02-10T12:00:00Z",
  "source": "Leaguepedia",
  "isPlaceholder": false,
  "teams": [
    {
      "id": "g2",
      "name": "G2 Esports",
      "players": [
        {
          "id": "g2-mid",
          "name": "Caps",
          "role": "mid",
          "gamesPlayed": 9,
          "champions": [
            {
              "champion": "Azir",
              "games": 6,
              "wins": 5,
              "losses": 1,
              "winrate": 0.83,
              "goldDiff15Avg": 850
            }
          ]
        }
      ]
    }
  ],
  "roleTopPicks": {
    "top": [{ "champion": "K'Sante", "picks": 22 }],
    "jungle": [],
    "mid": [],
    "adc": [],
    "support": []
  }
}
```

Notas para quien genere esto automáticamente:
- `role` debe ser exactamente uno de: `top`, `jungle`, `mid`, `adc`, `support`.
- `winrate` es un decimal (0–1), no porcentaje.
- `goldDiff15Avg` es la diferencia de oro media a los 15 minutos (entero, puede ser
  negativo). Se eligió el minuto 15 en vez del 14 porque es el estándar que ya traen
  calculado tanto Leaguepedia como Oracle's Elixir — sacar el 14 exacto requeriría
  procesar los timelines partido a partido vía la API de Riot, mucho más curro para
  poco beneficio.
- `roleTopPicks` es un agregado (picks totales por campeón en ese rol, sumando todos los
  equipos de la liga) — si el generador no lo calcula, el HTML también sabría derivarlo
  de `teams[]`, pero así se evita recalcular en el navegador.
- `isPlaceholder: true` hace que se muestre el aviso amarillo de "datos de ejemplo" en la
  web — importante ponerlo a `false` en cuanto los datos sean reales.
- `id` de cada jugador: sugerido `{equipo}-{rol}` para que sea único y estable.

## Fuente de datos recomendada

Como hablamos: **Leaguepedia (Cargo API)** como fuente principal — es una API real
(no scraping), con licencia CC BY-SA 3.0, pensada para este uso. Como respaldo o para
verificar cifras, Oracle's Elixir (pide atribución si se publica). Recomiendo dejar un
pie de página/tooltip en la web citando la fuente ("Datos: Leaguepedia"), tanto por buena
práctica como porque a futuro puede evitar fricciones si la sección crece.

## Pendiente de decidir con Mauro

- Qué ligas se cubren en el lanzamiento (LEC seguro, ¿LCK/LPL/LFL después?).
- Si el `lastUpdated` se muestra en la UI (útil para que el usuario sepa si los datos son
  de esta semana o de hace un mes).
- Umbral mínimo de partidas para que un campeón cuente en "mayor/menor winrate" (con 1
  partida un 100%/0% winrate no dice mucho) — de momento el HTML no filtra por esto,
  se puede añadir fácilmente si se quiere.
