# Contrato de API — OndeJoga Dashboard

Base URL: `/api` (proxy do nginx → serviço `api:8000`)

Todos os responses são JSON. Erros seguem `{"detail": "..."}` com status HTTP apropriado.

Documentação interativa (Swagger): `/api/docs` · OpenAPI: `/api/openapi.json`

---

## 0. Contas (escopo privado por usuário)

Tudo o que a seguir funciona **sem login** no escopo global (config/layout/fontes
compartilhados, somente leitura). Ao criar uma conta, o usuário passa a ter o
**próprio** `config`, `layout` e `api_sources`, inicializados com uma cópia dos
valores globais.

A sessão é um cookie httpOnly `ondejoga_session` (`path=/api`,
`SameSite=Lax`, 30 dias). O banco guarda apenas o SHA-256 do token. Senhas usam
PBKDF2-HMAC-SHA256 (260 mil iterações + sal por usuário).

O mesmo token sai no corpo do login/registro e é aceito como
`Authorization: Bearer <token>` — reserva do cookie para quando o navegador não
o envia, que é o caso do app embutido num iframe de site diferente (Home
Assistant). `deps._token_from` tenta cookie primeiro, depois o header.

### `POST /api/auth/register`

Body: `{ "username": "matheus", "password": "..." }` (username ≥ 3, senha ≥ 6)

```json
{
  "user": { "id": 1, "username": "matheus", "created_at": "2026-10-11T14:00:00Z" },
  "token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

`409` se o usuário já existir. Devolve o cookie de sessão junto.

> **Onboarding obrigatório:** logo após o registro (e sempre que uma conta não
> tem time escolhido) o front abre o modal `Qual é o seu time?` **sem botão de
> fechar e sem Escape**. Só depois de `POST /api/config/team` o painel é
> montado — enquanto `GET /api/config` responde `"owned": false`, o front não
> busca `GET /api/dashboard`.

### `POST /api/auth/login`

Body: `{ "username": "matheus", "password": "..." }` → mesmo formato. `401` em
credenciais inválidas.

### `POST /api/auth/logout` → `{ "ok": true }` (apaga a sessão e o cookie)

### `GET /api/auth/me`

```json
{ "authenticated": true, "user": { "id": 1, "username": "matheus", "team_name": "Cruzeiro" } }
```

Sem cookie válido: `{ "authenticated": false, "user": null }` (nunca 401).
`team_name` vem de `config.user.team.name` (vazio se a conta ainda não escolheu time).

### `PUT /api/auth/profile` (exige login)

```json
{ "username": "novo_nome", "password": "senha_atual", "new_password": "nova_senha" }
```

Os três campos são opcionais; ao menos um é obrigatório (`400` caso contrário).
Trocar senha ou nome **derruba as outras sessões** (a atual é preservada).
`409` se o nome já existir, `401` se a senha atual estiver errada, `422` se a
validação falhar (nome ≥ 3, senha nova ≥ 6).

```json
{ "user": { "id": 1, "username": "novo_nome", "team_name": "Cruzeiro" } }
```

### `POST /api/auth/reset-file` (exige login)

Gera uma senha temporária, grava `RESET-<username>.txt` **na raiz do volume do
projeto** (`RESET_DIR`, no Docker = `/ondejoga` = pasta do `docker-compose.yml`)
e troca a senha da conta. O arquivo é escrito **antes** da troca: se a gravação
falhar, a conta continua acessível com a senha atual.

```json
{
  "username": "matheus",
  "file": "RESET-matheus.txt",
  "path": "/ondejoga/RESET-matheus.txt",
  "password": "42c6-eed2-4720-ca4b"
}
```

Arquivo gravado com modo `0600` e dono = dono da pasta montada (no Docker o
processo é root e faz `chown` para o uid/gid da pasta, então o host lê sem
`sudo`). As outras sessões da conta são destruídas; a atual permanece.

### Efeito no restante da API

| Ação | anônimo | logado |
|---|---|---|
| `GET /api/config` · `/dashboard` · `/standings` … | escopo global | **seu** escopo (herda do global o que você nunca editou) |
| `PUT /api/config` · `PUT /api/layout` · `POST /api/layout/reset` · `POST /api/config/restore` | **401** | grava no **seu** escopo |
| `GET/POST/PUT/DELETE /api/admin/sources` | `GET` global; escrita **401** | suas próprias fontes |

Ao registrar, o usuário recebe `seed_sources` (cópia das fontes padrão) e o
layout padrão. `GET /api/layout` responde `{"owned": true|false}` no corpo para
o front saber se o layout está no escopo do usuário ou é o global.

> O front **não** mostra um time padrão para quem não tem sessão: sem cookie
> válido ele exibe a tela de boas-vindas (criar conta / entrar) e nem sequer
> chama `GET /api/dashboard`.

---

## 1. `GET /api/health`

`version` é a release versionada (muda quando se corta uma release); o resto
vem do git em tempo de execução — a API lê o repositório que o
`docker-compose.yml` monta no container, então **muda sozinho a cada commit**,
sem ninguém precisar atualizar um número. Sem repositório montado (`source`
igual a `release`) os campos de git vêm `null`.

```json
{
  "status": "ok",
  "database": "up",
  "version": "1.1.0",
  "commit": "0606bad",
  "branch": "main",
  "tag": "0606bad",
  "dirty": false,
  "source": "git"
}
```

`dirty: true` significa que o que está de pé não veio de um commit limpo.
Os mesmos campos aparecem em `GET /api`.

## 2. `GET /api/config` · `PUT /api/config`

Configuração do time/aplicação (persistida no PostgreSQL).

```json
{
  "team": {
    "name": "Cruzeiro",
    "short_name": "Cruzeiro",
    "city": "Belo Horizonte",
    "state": "MG",
    "primary_color": "#0093EC",
    "secondary_color": "#FFFFFF",
    "logo": "https://r2.thesportsdb.com/images/media/team/badge/upsvvu1473538059.png",
    "ids": {
      "thesportsdb": "134294",
      "espn": "2022",
      "espn_league": "bra.1",
      "football_data": "",
      "api_football": "135"
    },
    "competitions": [
      {
        "id": "4351",
        "name": "Brasileirão Série A",
        "provider": "thesportsdb",
        "kind": "league",
        "page": "Campeonato Brasileiro de Futebol de {season} - Série A"
      },
      {
        "id": "4725",
        "name": "Copa do Brasil",
        "provider": "thesportsdb",
        "kind": "cup",
        "page": "Copa do Brasil de Futebol de {season}"
      }
    ]
  },
  "timezone": "America/Sao_Paulo",
  "locale": "pt-BR",
  "refresh_interval_seconds": 300,
  "default_theme": "system"
}
```

`PUT /api/config` aceita o mesmo objeto parcial (merge profundo) e devolve o objeto completo.

`GET /api/config` inclui `"owned": true|false` — `true` quando a config pertence
ao escopo do usuário logado, `false` quando é a global (ex.: conta recém-criada,
que ainda não escolheu time). É o campo que decide se o portão de escolha de
time abre.

Detalhes importantes:
- `ids` guarda o id do time em **cada** provedor (cada API usa sua própria numeração). O resolvedor escolhe o id certo conforme a fonte que atende a capacidade.
- `ids.espn_league` é a liga usada pelo provedor ESPN (ex.: `bra.1`).
- `competitions[].kind` (opcional, `"league"` por padrão) descreve o formato: `"league"` = pontos corridos (tabela de classificação), `"cup"` = mata-mata (a informação útil é a **fase atual da equipe**).
- `competitions[].page` (opcional) é o título da página da Wikipédia com a tabela da competição; `{season}` é substituído pelo ano corrente. Sem `page`, a competição fica fora da seção de tabelas.
- `team.primary_color`/`secondary_color` são a base do tema: o front deriva automaticamente a paleta clara **e** escura a partir delas (ver `web/src/lib/color.ts`).

## 3. `GET /api/dashboard`

Agrega tudo que a tela principal precisa.

```json
{
  "team": { "...mesmo formato de config.team..." },
  "next_match": {
    "id": "2398483",
    "competition": { "id": "4351", "name": "Brasileirão Série A", "logo": "https://..." },
    "kickoff": "2026-10-13T00:00:00Z",
    "status": "Não iniciado",
    "round": "30",
    "home": { "id": "134736", "name": "Bragantino", "logo": "https://...", "score": null },
    "away": { "id": "134294", "name": "Cruzeiro", "logo": "https://...", "score": null },
    "venue": { "name": "Estádio Cicero de Souza Marques", "city": null },
    "broadcasts": [ { "name": "Premiere", "country": "BR", "url": null, "logo": null } ],
    "source": "thesportsdb"
  },
  "last_match": {
    "id": "2398474",
    "competition": { "id": "4351", "name": "Brasileirão Série A", "logo": "..." },
    "finished_at": "2026-10-08T00:30:00Z",
    "status": "Encerrado",
    "round": "29",
    "home": { "id": "134294", "name": "Cruzeiro", "logo": "...", "score": 2 },
    "away": { "id": "134434", "name": "São Paulo", "logo": "...", "score": 0 },
    "venue": { "name": "Mineirão", "city": "Belo Horizonte" },
    "broadcasts": [],
    "source": "thesportsdb"
  },
  "live_match": {
    "id": "401841266",
    "competition": { "id": "630", "name": "Brasileirão Série A", "logo": null },
    "kickoff": "2026-10-11T22:30:00Z",
    "finished_at": null,
    "status": "87'",
    "round": null,
    "home": { "id": "9967", "name": "Bahia", "logo": "https://...", "score": 1 },
    "away": { "id": "9169", "name": "Mirassol", "logo": "https://...", "score": 0 },
    "venue": { "name": "Arena Fonte Nova", "city": "Salvador" },
    "broadcasts": [],
    "source": "espn",
    "is_live": true
  },
  "standings": [
    {
      "competition": { "id": "4351", "name": "Brasileirão Série A", "logo": "...", "kind": "league" },
      "season": "2026",
      "updated_at": "2026-10-11T10:00:01Z",
      "highlight_team_id": "134294",
      "kind": "league",
      "group": null,
      "stage": null,
      "team_stage": null,
      "description": "Brasileirão Série A · Pontos corridos · 2026",
      "rows": [
        {
          "position": 1,
          "team": { "id": "134287", "name": "Flamengo", "logo": "..." },
          "played": 29, "won": 18, "drawn": 7, "lost": 4,
          "goals_for": 57, "goals_against": 25, "goal_difference": 32,
          "points": 61, "form": "DWWWW", "note": "Libertadores (fase de grupos)"
        }
      ]
    },
    {
      "competition": { "id": "4725", "name": "Copa do Brasil", "logo": "...", "kind": "cup" },
      "season": "2026",
      "kind": "cup",
      "group": null,
      "stage": "Oitavas de final",
      "team_stage": "Quartas de final",
      "description": "Copa do Brasil — Oitavas de final",
      "phase": "Oitavas de final",
      "phase_order": 10,
      "is_current": false,
      "team_alive": true,
      "rows": [],
      "bracket": [
        {
          "label": "E",
          "home": { "id": "134294", "name": "Cruzeiro", "logo": "...", "score": 2 },
          "away": { "id": "134287", "name": "Flamengo", "logo": "...", "score": 3 },
          "aggregate": "2–3",
          "legs": ["1–1", "1–2"],
          "penalties": null,
          "winner": "away",
          "decided": true
        },
        {
          "label": "F",
          "home": { "id": null, "name": "Palmeiras", "logo": null, "score": null },
          "away": { "id": null, "name": "São Paulo", "logo": null, "score": null },
          "aggregate": null,
          "legs": ["15 out", "22 out"],
          "penalties": null,
          "winner": null,
          "decided": false
        }
      ]
    }
  ],
  "news": [
    {
      "id": "hash",
      "title": "...",
      "summary": "...",
      "url": "https://...",
      "image": "https://s2-g1.glbimg.com/....jpeg",
      "published_at": "2026-10-11T08:00:00Z",
      "source": "Google Notícias"
    }
  ],
  "stats": {
    "season": {
      "competition": "Brasileirão Série A", "position": 6, "played": 28,
      "won": 13, "drawn": 6, "lost": 9, "goals_for": 42, "goals_against": 40,
      "goal_difference": 2, "points": 45, "form": "WLWLW"
    },
    "home": { "played": 14, "won": 7, "drawn": 4, "lost": 3, "goals_for": 22, "goals_against": 14 },
    "away": { "played": 14, "won": 6, "drawn": 2, "lost": 6, "goals_for": 20, "goals_against": 26 },
    "goals_scored": 42, "goals_conceded": 40,
    "clean_sheets": 8, "avg_goals_scored": 1.5, "avg_goals_conceded": 1.43,
    "unbeaten_streak": 1, "win_streak": 1, "goalless_draws": 3,
    "recent_form": [
      { "id": "...", "date": "2026-10-08", "opponent": "São Paulo", "result": "W",
        "score": "2-0", "venue": "home", "competition": "Brasileirão Série A" }
    ],
    "top_scorers": [ { "name": "Matheus Pereira", "goals": 9, "assists": 6, "matches": 25 } ]
  },
  "meta": {
    "generated_at": "2026-10-11T14:00:00Z",
    "cached": false,
    "sources": [
      { "capability": "standings", "source": "thesportsdb", "status": "ok", "error": null },
      { "capability": "news", "source": "rss", "status": "fallback", "error": "timeout" }
    ]
  }
}
```

Notas:
- **Idioma**: nenhuma fonte fala português. `status`, o nome da competição (`competition.name`) e o nome do campeonato nas estatísticas (`stats.season.competition`, `stats.recent_form[].competition`) são traduzidos na fronteira (`app/labels.py`), depois que o provedor fez o trabalho dele — é por isso que o cronômetro (`"87'"`) e horário por extenso (`"7:30 PM ET"`) chegam intactos, e só o que é reconhecido vira rótulo. Tradução é por **id** da competição quando existe; sem id conhecido, cai no nome em inglês (um ano no começo do nome, tipo `"2026 Brasileiro Serie A"`, é preservado). Como a tradução mora nos modelos, o backup embarcado (`fallback.json`) também sai em português.
- `live_match` é o jogo em **andoamento** agora (widget "Tempo Real"): `status` traz o período/cronômetro (ex.: `"87'"`, `"Intervalo"`), `finished_at` fica `null` e `is_live` é `true`. `null` = o time não está jogando neste momento (o front oculta o widget).
- `standings[]` descreve **qual** competição é cada tabela: `competition.kind` (`"league" | "cup"`), `kind`, `group` (ex.: `"Grupo D"`, em fase de grupos), `stage`/`team_stage` (fase do mata-mata — o do time monitorado) e `description` (texto pronto para exibir).
- **Abas**: cada item de `standings[]` é uma aba do widget "Tabelas". `phase` agrupa as tabelas em abas de fase (ex.: `"Fase de grupos"`, `"Oitavas de final"`, `"Quartas de final"`), `phase_order` dá a ordem do torneio (grupos = `0`, mata-mata = `rank + 1`) e `is_current` marca a fase atual do time (a aba padrão).
- `team_alive`: `false` quando o time já foi eliminado (o front oculta a competição por padrão — opção `hide_eliminated`), `true` enquanto seguir vivo e `null` quando não dá para saber (pontos corridos).
- Em mata-mata as tabelas trazem `bracket[]` com os confrontos: `home`/`away`, `aggregate` (placar agregado), `legs` (resultado/data de cada jogo), `penalties`, `winner` (`"home"`/`"away"`/`null`) e `decided` (`false` = ainda será disputado). `rows` fica vazio; quando a fase atual ainda não tem chave publicada, `bracket` é `[]` e só a aba com o nome da fase é exibida.
- A fase com `is_current: true` pode não ser a última da lista — é sempre a fase **do time monitorado**.
- `stats.top_scorers` pode ser `[]` quando a fonte não disponibiliza.
- `news[].image` é preenchida pelo backend: o feed do Google Notícias não traz imagem, então ele resolve a URL real do artigo (página + assinatura `data-n-a-sg/ts` → `batchexecute`), lê o `og:image`/`twitter:image` e cacheia por URL (TTL 6h). Sem imagem, o campo fica `null` e o front mostra um placeholder — nunca um link quebrado.
- Qualquer seção pode ser `null` se não houver fonte disponível; o front deve renderizar estado vazio.
- `meta.sources[].status` ∈ `"ok" | "fallback" | "error"` (`fallback` = aplicou dados de backup embarcados).

## 4. Endpoints individuais (mesmos formatos, uma seção cada)

- `GET /api/next-match` → objeto `Match` (404 se indisponível)
- `GET /api/last-match` → objeto `Match` (404 se indisponível)
- `GET /api/live-match` → objeto `Match` com `is_live: true` ou **`null`** (200 — "sem jogo agora" é resposta normal; o front faz poll deste endpoint a cada 20s com jogo em andamento, 60s parado)
- `GET /api/standings` → array de tabelas (pode ser `[]`)
- `GET /api/news?limit=8` → array de notícias
- `GET /api/stats` → objeto `Stats` (404 se indisponível)
- `GET /api` → índice de endpoints + versão

`GET /api/dashboard?limit=8&refresh=true` — `refresh=true` ignora o cache agregado.

## 5. Times (busca e seleção)

### `GET /api/teams/search?q=cruzeiro` (público)

Busca de times para o onboarding e para trocar de time. `q` com ≥ 2 caracteres
(`422` abaixo disso), `502` se todas as fontes caírem.

```json
{
  "query": "cruzeiro",
  "results": [
    {
      "provider": "thesportsdb",
      "id": "134294",
      "name": "Cruzeiro",
      "short_name": "CRU",
      "logo": "https://r2.thesportsdb.com/images/media/team/badge/upsvvu1473538059.png",
      "country": "Brazil",
      "league": "Brazilian Serie A"
    }
  ]
}
```

Só times de futebol (fontes do tipo `team_search`), ordenados pelo começo do
nome, limitado a 20 resultados. Cache 120s.

### `POST /api/config/team` (exige login)

```json
{ "provider": "thesportsdb", "id": "134294" }
```

Monta o `config.team` completo a partir do id (lookup + IDs de cada provedor +
`competitions` derivadas das ligas do time, com Copa do Brasil automática para o
Brasil), grava no escopo do usuário e devolve o `config_payload`
(`config` + `owned`). `404` se o id não existir, `502` se a fonte estiver fora.

- Escolher **outro** time troca tudo (nome, cores, ids, competitions) e invalida
  o cache do dashboard do usuário.
- Escolher o **mesmo** time preserva cidade/estado/competitions editados à mão.
- A troca só é permitida com sessão (`401`).


## 6. Layout / widgets

### `GET /api/layout`

```json
{
  "theme": { "default": "system", "accent": "auto" },
  "refresh_interval_seconds": 300,
  "widgets": [
    {
      "id": "my_team",
      "type": "my_team",
      "title": "Meu Time",
      "visible": true,
      "order": 0,
      "size": "sm",
      "options": { "metrics": [], "show_chart": true, "show_top_scorers": true }
    },
    {
      "id": "next_match",
      "type": "next_match",
      "title": "Próximo Jogo",
      "visible": true,
      "order": 0,
      "size": "md",
      "options": {}
    },
    {
      "id": "standings",
      "type": "standings",
      "title": "Tabelas",
      "visible": true,
      "order": 3,
      "size": "lg",
      "options": { "max_rows": 20, "competitions": [], "hide_eliminated": true }
    }
  ]
}
```

- `size` ∈ `"sm" | "md" | "lg" | "full"`
- `type` ∈ `"my_team" | "team_header" | "next_match" | "last_match" | "live_match" | "standings" | "news" | "stats" | "form"` (`team_header` e `stats` continuam aceitos em layouts antigos; o padrão usa `my_team`, que junta identidade + estatísticas num cartão só)
- Layouts gravados em versões antigas ganham automaticamente os widgets novos do padrão (ex.: `live_match`, com `order` maior que os existentes) sem tocar na personalização do usuário.
- `theme.accent`: hex **ou** `"auto"` (padrão) = a cor de destaque segue `config.team.primary_color`, derivada por modo (clara/escura). Um valor hex fixa o destaque manualmente.
- `options` é livre (cada widget lê o que precisa; opções conhecidas abaixo):
  - `standings`: `max_rows` (número), `competitions` (array de ids), `hide_eliminated` (bool, padrão `true` = esconde competições em que o time já caiu)
  - `news`: `limit` (número)
  - `stats` / `my_team`: `metrics` (array de chaves), `show_top_scorers` (bool), e `my_team` também `show_chart` (bool)
  - `form`: `limit` (número)
  - `next_match`: `show_broadcasts` (bool), `show_countdown` (bool)
  - `live_match`: `show_status` (bool = período/cronômetro), `show_venue` (bool = estádio)

### `PUT /api/layout`

Body: objeto completo no formato acima. Valida: ids não duplicados, types conhecidos, sizes válidos. Devolve o layout salvo.

### `POST /api/layout/reset` → devolve o layout padrão.

### `POST /api/config/restore` (exige login)

Volta ao padrão **só o que a pessoa marcar**. É o recurso de manutenção para quando o painel quebra e não fica óbvio o que foi mexido.

```json
{ "current_password": "segredo123", "items": ["sources", "layout", "config"] }
```

| item | o que zera |
|---|---|
| `sources` | apaga as fontes do **seu** escopo e recria as de fábrica (as fontes globais, do visitante, não são tocadas) |
| `layout` | volta os widgets à ordem, tamanho e visibilidade padrão |
| `config` | apaga a config do usuário: tema, idioma, fuso, intervalo de atualização e o time. `owned` vira `false` e o portão de onboarding volta a exigir a escolha do time |

A senha atual é sempre exigida (`401` quando errada); seleção vazia ou item desconhecido dá `422`. Resposta:

```json
{ "reset": ["sources", "layout"], "sources_count": 5 }
```

`users` e `user_sessions` ficam intactos — conta, senha e a sessão aberta sobrevivem. O cache e o status em memória são limpos junto, senão a tela continuaria exibindo o que veio das fontes antigas.

## 7. CRUD de APIs (fontes de dados)

### `GET /api/admin/sources`

```json
[
  {
    "id": 1,
    "name": "TheSportsDB",
    "kind": "thesportsdb",
    "enabled": true,
    "priority": 10,
    "capabilities": ["team", "standings", "next_match", "last_match", "stats", "tv"],
    "base_url": "https://www.thesportsdb.com/api/v1/json/{api_key}/",
    "api_key": "3",
    "headers": {},
    "endpoints": {
      "standings": "lookuptable.php?l={competition_id}&s={season}",
      "next_match": "eventsnextall.php?id={team_id}",
      "last_match": "eventslast.php?id={team_id}",
      "team": "lookupteam.php?id={team_id}",
      "tv": "eventstv.php?id={event_id}"
    },
    "mapping": {},
    "cache_ttl_seconds": 600,
    "timeout_seconds": 8,
    "notes": "",
    "last_status": "ok",
    "last_error": null,
    "last_success_at": "2026-10-11T14:00:00Z"
  }
]
```

- `kind` ∈ `"thesportsdb" | "espn" | "rss" | "football_data" | "api_football" | "url_json" | "static_json" | "wikipedia" | "jogostv"`
- `priority`: menor número = testado primeiro. Capacidades atendidas pela fonte de menor `priority` (habilitada) ganham.
- `endpoints`: template com placeholders `{api_key} {team_id} {competition_id} {season} {year} {league} {espn_league} {event_id} {limit} {query} {date} {timezone} {locale}`. O valor de `{team_id}` é o id do provedor atual (lido de `config.team.ids`).
- `capabilities` conhecidas: `team`, `teams`, `standings`, `next_match`, `last_match`, `live_match`, `news`, `stats`, `tv`, `broadcasts`.
- `mapping`: usado pelos adapters `url_json` e `static_json` para extrair dados de qualquer REST API/JSON:

```json
{
  "standings": {
    "root": "table",
    "fields": {
      "position": "intRank", "team_name": "strTeam", "team_id": "idTeam",
      "team_logo": "strBadge", "played": "intPlayed", "won": "intWin",
      "drawn": "intDraw", "lost": "intLoss", "goals_for": "intGoalsFor",
      "goals_against": "intGoalsAgainst", "goal_difference": "intGoalDifference",
      "points": "intPoints", "form": "strForm"
    }
  },
  "next_match": {
    "root": "events",
    "select": "next",
    "fields": {
      "id": "idEvent", "kickoff": "strTimestamp", "competition_name": "strLeague",
      "competition_id": "idLeague", "home_name": "strHomeTeam", "away_name": "strAwayTeam",
      "home_id": "idHomeTeam", "away_id": "idAwayTeam", "venue": "strVenue",
      "round": "intRound", "status": "strStatus", "home_logo": "strHomeTeamBadge",
      "away_logo": "strAwayTeamBadge"
    }
  }
}
```

- Caminhos usam notação de ponto com índices (`events.0.strTimestamp`); string vazia = raiz da resposta.
- `root` aponta para o objeto ou a **lista** de registros. Quando é lista, `select` escolhe qual registro vira o jogo único:
  - `"first"` (padrão) · `"next"` (mais próximo do futuro) · `"last"` (mais recente por data) · `"finished"` (jogo encerrado mais recente — o indicado para `last_match`).
- Capacidades de lista (`standings`, `news`, `tv`, `broadcasts`) renderizam todos os registros; as demais (`next_match`, `last_match`, `live_match`, `stats`, `team`) esperam um objeto único. Em `live_match` o adapter marca `is_live: true` e não considera fim de jogo.
- No adapter `static_json` o `mapping.tv` aceita `{"by_competition": {"4351": [{"name": "Premiere"}], "default": [...]}}` ou uma lista direta — nesse adapter nada é buscado externamente. O kind continua disponível no CRUD para quem quiser manter uma lista à mão, mas não vem mais semead como fonte de `tv`.

### `POST /api/admin/sources` · `PUT /api/admin/sources/{id}` · `DELETE /api/admin/sources/{id}`

Body de criação/edição: mesmo formato (sem `id`/campos de status). Validações:
- `name` obrigatório, `kind` conhecido, `capabilities` não vazio, `priority` ≥ 0.
- `base_url` precisa ser `http://` ou `https://` (exceto para `static_json`).

### `POST /api/admin/sources/test`

Body: `{ "id": 7 }` **ou** `{ "source": { ...fonte não salva... }, "capability": "standings" }`.

Resposta (`sample` = primeiros ~2KB da resposta bruta; `normalized` = dados já convertidos para o formato canônico, quando a conversão é possível):

```json
{
  "ok": true,
  "status_code": 200,
  "elapsed_ms": 231,
  "url": "https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=4351&s=2026",
  "sample": { "...primeiros 2KB da resposta..." },
  "normalized": [ { "name": "Premiere", "country": "BR", "url": null, "logo": null } ],
  "error": null
}
```

Para `static_json` não há `url`/`status_code` (nada é buscado) — `normalized` vem direto do `mapping`.

### `GET /api/admin/status`

```json
{
  "capabilities": [
    { "capability": "standings", "active_source": "thesportsdb", "status": "ok",
      "error": null, "last_success_at": "...", "fallbacks_available": ["url_json"] }
  ]
}
```

## 8. Fontes padrão (seed)

Roda automaticamente na primeira subida (só quando a tabela está vazia) e nunca sobrescreve fontes do usuário. Na subida também roda uma **migração leve**, em três passos: capacidades/endpoints novos do padrão (ex.: `live_match` da ESPN) são acrescentados às fontes já semeadas em versões antigas; a lista estática de TV é desligada (mantida no CRUD, só fora do caminho); e uma fonte padrão entra quando o escopo fica sem nenhuma para uma capacidade — é assim que contas antigas ganham o JogosTV.

| name | kind | priority | capabilities |
|---|---|---|---|
| TheSportsDB | thesportsdb | 10 | team, next_match, last_match |
| ESPN | espn | 20 | team, teams, next_match, last_match, stats, broadcasts, live_match |
| Wikipédia | wikipedia | 30 | standings |
| Google Notícias (RSS) | rss | 40 | news |
| JogosTV | jogostv | 50 | tv |

Por que cada fonte ficou onde ficou (baseado em testes contra as APIs reais):
- **TheSportsDB** entrega time e jogos com a chave grátis `3`, mas a tabela de classificação grátis (`lookuptable.php`) retorna só 5 linhas — por isso ela **não** cuida de `standings`.
- **ESPN** (sem chave) é a fonte de `stats` (calculadas do histórico de jogos) e de `teams` (escudos usados para enriquecer as tabelas). A tabela de classificação do site.api retorna `{}` (quebrada) e os jogos futuros vêm do `sports.core.api`.
- **Wikipédia** (MediaWiki, sem chave) tem a tabela completa de 20 linhas; a página é configurada por competição em `config.team.competitions[].page`.
- **Google Notícias RSS** varre notícias pelo nome do time (`{query}`).
- **JogosTV** lê a grade real por jogo no HTML do site (`article.game-row` com `data-channels`), casando data + nome do time. É a única fonte gratuita que cobre o Brasileirão: a ESPN devolve `broadcasts` vazio no Brasil, a TheSportsDB desligou o `eventstv.php` e as demais são pagas. Jogo sem canal confirmado devolve lista vazia — **sem grade, não existe a seção "Onde assistir"**, nunca uma lista genérica. O `mapping.pages` aponta a página de cada competição.

## 9. Resiliência (como o app se comporta quando uma API morre)

1. Para cada capacidade, o resolvedor tenta as fontes habilitadas em ordem de `priority`.
2. Cada tentativa fica em cache (TTL por fonte) e alimenta `last_status`/`last_error` da fonte + o status em memória mostrado em `/api/admin/status`.
3. Se **todas** falharem, o app entrega os dados de backup embarcados (`api/app/data/fallback.json`) com `meta.sources[].status = "fallback"` — a tela nunca fica vazia. **Exceto `tv`/`broadcasts`**: essa capacidade ficou de fora do backup de propósito, porque sem grade por jogo não há como saber quem transmite e um chute apareceria na tela como se fosse dado real.
4. `?refresh=true` em `/api/dashboard` pula o cache agregado (TTL configurável via `DASHBOARD_CACHE_TTL`).

Regenerar o backup com dados frescos:

```bash
cd api && DATABASE_URL=sqlite:////tmp/ondejoga_fallback.db ALLOW_NETWORK=1 \
  .venv/bin/python -m scripts.generate_fallback
```

Fluxo previsto para trocar de API quando uma morrer: cadastre a nova fonte em `/api/admin` (ou `POST /api/admin/sources`), use `POST /api/admin/sources/test` para conferir o payload normalizado, ajuste `priority` para ela assumir e só então desabilite a fonte quebrada.
