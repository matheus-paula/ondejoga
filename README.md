# OndeJoga ⚽

Dashboard do **seu time** — próximo jogo, último resultado, **jogo ao vivo em tempo
real** (widget "Tempo Real", só enquanto o time está em campo), tabelas dos
campeonatos disputados, notícias e estatísticas — com **dark/light theme**,
**contas** (cada um acompanha o seu time, em privado) e um **CRUD de APIs** para
trocar as fontes de dados quando uma API cair.

Vem configurado para o **Cruzeiro-MG**, mas trocar de time é uma edição de
configuração (nada de código).

## Subir tudo com um comando

```bash
docker compose up --build
```

Pronto: **http://localhost:3999** — ou pelo IP da máquina na rede local, para
acessar de outro aparelho. Só **uma porta** é publicada.

```bash
# descobre o IP que a máquina usa na rede local (Linux)
ip -4 route get 1.1.1.1 | grep -oP 'src \K[\d.]+'
# => http://172.19.33.101:3999   (nesta máquina)
```

- Porta ocupada? `APP_PORT=4000 docker compose up --build`
- Rodou e não sabe se subiu? `docker compose ps` (os três serviços devem
  aparecer `healthy`) e `docker compose logs -f api`

Painel em `/` · administração das fontes em `/#/admin` · documentação OpenAPI em
`/api/docs`.

## O que tem dentro

| Serviço | Imagem | O que faz | Porta |
|---|---|---|---|
| `web` | nginx | Serve o bundle do React e faz proxy de `/api` para a API | **3999 → 80** (única exposta) |
| `api` | python:3.12-slim | FastAPI: resolve fontes, cache, fallback, CRUD | interna (8000) |
| `db` | postgres:16-alpine | Guarda **só** configuração (`settings`, `api_sources`, `users`, `user_sessions`) | interna (5432) |

Os dados esportivos **não** ficam no banco — vêm das APIs a cada refresh (com
cache em memória). O PostgreSQL existe apenas para persistir suas configurações,
o registro das fontes e as contas.

```
ondejoga/
├── docker-compose.yml      # sobe tudo (compose v2+)
├── .env.example            # variáveis opcionais (porta, credenciais, cache)
├── docs/API_CONTRACT.md    # contrato backend ↔ frontend
├── api/                    # FastAPI + provedores + testes pytest
└── web/                    # React + Vite + vitest + e2e Playwright (web/e2e)
```

## Fontes de dados (todas verificadas ao vivo)

| Fonte | Capacidades | Chave |
|---|---|---|
| TheSportsDB | time, próximo jogo, último jogo | grátis (`3`) |
| ESPN | calendário/resultados, estatísticas, escudos dos times, **jogo ao vivo** (Tempo Real) | nenhuma |
| Wikipédia (MediaWiki) | tabelas de classificação completas | nenhuma |
| Google Notícias (RSS) | notícias | nenhuma |
| TV estático | transmissoras por competição | nenhuma (é o seu mapeamento) |

## Contas (cada um com o seu time)

A **API** funciona sem login no escopo global, mas a **interface** não mostra um
time pronto: sem sessão o painel abre numa tela de boas-vindas com **Criar
conta** e **Já tenho conta** — só depois de entrar é que o dashboard carrega. Para
ter um painel seu, clique em **Criar conta** (ou `POST /api/auth/register`):

- a sessão é um cookie httpOnly de 30 dias (`ondejoga_session`, só em `/api`);
- quem se registra recebe uma **cópia** da config, do layout e das fontes — a
  partir daí **só ele** mexe no que é dele; nada vaza para os outros usuários;
- cada usuário pode ter um time, uma cor e um layout diferentes — inclusive no
  mesmo navegador (troque de conta e o painel muda junto).

| Ação | anônimo | logado |
|---|---|---|
| ver o dashboard | escopo global | o **seu** escopo |
| salvar config/layout/fontes | `401` | o **seu** escopo |

```bash
curl -c jar -X POST http://localhost:3999/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"matheus","password":"segredo123"}'
curl -b jar http://localhost:3999/api/auth/me
curl -b jar -X POST http://localhost:3999/api/auth/logout
```

### E quando uma API cair?

O resolvedor tenta as fontes habilitadas em ordem de prioridade. Se **todas**
falharem, o dashboard entrega os dados de backup embarcados
(`api/app/data/fallback.json`) e mostra um selo "dados de fallback" no cabeçalho.
A tela nunca fica vazia.

Para trocar uma fonte que morreu, sem tocar em código:

1. `/#/admin` → **Nova fonte** (ou `POST /api/admin/sources`) — escolha o `kind`
   (`url_json` aceita qualquer REST API com `mapping` declarativo);
2. **Testar** a fonte e conferir o payload normalizado;
3. Ajuste a `priority` para ela assumir e desabilite a fonte quebrada.

Detalhes de cada endpoint em [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Personalizar (máxima flexibilidade)

Tudo é configuração — a interface se rearranja sozinha.

### Trocar o time

`PUT /api/config` (merge parcial) ou editar direto no banco:

```bash
curl -X PUT http://localhost:3999/api/config -H 'Content-Type: application/json' -d '{
  "team": {
    "name": "Cruzeiro",
    "primary_color": "#0093EC",
    "logo": "https://.../escudo.png",
    "ids": { "thesportsdb": "134294", "espn": "2022", "espn_league": "bra.1" },
    "competitions": [
      { "id": "4351", "name": "Brasileirão Série A",
        "page": "Campeonato Brasileiro de Futebol de {season} - Série A" }
    ]
  }
}'
```

- `ids` guarda o id do time **em cada provedor** (cada API usa numeração própria).
- `competitions[].page` (opcional) é o título da página da Wikipédia com a
  classificação; `{season}` vira o ano corrente. Sem `page`, a competição fica
  fora da seção de tabelas.

### Reorganizar os cards

`/#/admin` → painel **Personalizar** (arraste, reordene, renomeie, oculte, troque
tamanho e cor de destaque) — ou por API:

```bash
curl -X PUT http://localhost:3999/api/layout -H 'Content-Type: application/json' -d '{
  "theme": { "default": "dark", "accent": "auto" },
  "widgets": [ { "id": "news", "type": "news", "title": "Notícias", "visible": false,
                 "order": 5, "size": "md", "options": { "limit": 6 } } ]
}'

curl -X POST http://localhost:3999/api/layout/reset   # volta ao padrão
```

Widgets disponíveis: `my_team` (identidade do clube + estatísticas, num cartão só),
`next_match`, `last_match`, `live_match`, `standings`, `news`, `stats`, `form`.
`team_header` e `stats` continuam aceitos em layouts antigos. Tamanhos: `sm`,
`md`, `lg`, `full`.

Os cartões de jogo são **padronizados**: mesmo escudo (44px) nos dois lados do
Próximo/Último Jogo e do Tempo Real, e o placar sempre **colado ao "×"**
(`escudo nome 2 × 0 nome escudo`), nunca junto ao nome do clube.

O widget **Tempo Real** (`live_match`) aparece **só enquanto o time estiver em
campo** — placar atual, período/cronômetro (ex.: "87'"), estádio e o selo
pulsante "AO VIVO". Quando não há jogo ele nem é renderizado (o front consulta
`GET /api/live-match` a cada 20s com jogo rolando, 60s parado; a resposta é
`null` quando o time não está jogando). Instalações antigas recebem o widget
automaticamente no fim do layout, sem mexer no que você já personalizou.

Cada tabela **descreve a competição**: nome, logo, formato (pontos corridos ou
mata-mata), grupo (em fase de grupos) e, nas copas, a **fase atual do seu time**
(por exemplo "Quartas de final"), sem tabela vazia.

O widget **Tabelas** é navegável em abas:

- **competição** → só aparece nas competições em que o time está ativo
  (as eliminadas somem por padrão; desligue com a opção `hide_eliminated`);
- **fase** → cada fase do mata-mata vira uma aba (grupos, oitavas, quartas,
  semis, final), sempre abrindo na **fase atual do time**;
- **grupo** → chips "Grupo A…H" quando a fase tem várias tabelas;
- nas fases finais a tabela é uma **chave**: confronto a confronto, com escudos,
  placar agregado, pênaltis, jogos e o vencedor destacado.

### Tema

- **A cor vem do time**: o tema claro e o escuro são derivados de
  `team.primary_color` (contraste calculado, nada de azul ilegível sobre branco).
  `accent: "auto"` (padrão) segue o time; escolhendo uma cor no painel, ela fica
  fixa.
- Escuro/claro pelo botão no cabeçalho (preferência guardada no navegador);
- `layout.theme.default` (`system` | `light` | `dark`) define o padrão para quem
  nunca escolheu.

### Variáveis de ambiente (`.env`, todas opcionais)

| Variável | Padrão | O que faz |
|---|---|---|
| `APP_PORT` | `3999` | porta publicada na rede local |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `ondejoga` | credenciais do banco (internas) |
| `ALLOW_NETWORK` | `1` | `0` = modo offline (só backup local) |
| `DASHBOARD_CACHE_TTL` | `60` | cache do payload agregado (s) |
| `DEFAULT_CACHE_TTL` | `300` | TTL padrão por fonte (s) |
| `CORS_ORIGINS` | `*` | origens permitidas na API |
| `COOKIE_SECURE` | `0` | `1` quando o app for servido por HTTPS |

## Testes

Testes rodam offline (rede bloqueada, banco SQLite temporário) — nada depende de
internet para passar.

```bash
# Backend (138 testes: contas, escopo por usuário, resolução de fontes, cache,
# fallback, CRUD, providers, fase de copa, chaves de mata-mata, imagens de
# notícia, jogo ao vivo, API)
cd api
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest

# Frontend (49 testes: widgets, abas de competição/fase, chaves, tema derivado
# do time, contas + tela de boas-vindas, drawer, admin, cliente HTTP, Tempo Real)
cd web
npm install
npm test        # vitest
npm run build   # checagem de tipos + build de produção

# E2E (Playwright, 9 cenários contra o stack de verdade)
npm run test:e2e:install                  # uma vez: baixa o Chromium
docker compose up -d --build              # stack em http://localhost:3999
npm run test:e2e                          # E2E_BASE_URL p/ outra porta/host
```

## Solução de problemas

| Sintoma | Causa / solução |
|---|---|
| `port is already allocated` | `APP_PORT=4000 docker compose up --build` |
| Dashboard mostra "dados de fallback" | Uma ou mais fontes externas fora. Veja o motivo em `/#/admin` → **Status** ou `GET /api/admin/status` |
| `api` reiniciando | `docker compose logs api` — quase sempre é o banco: `docker compose logs db` |
| Quer regenerar o backup offline | `cd api && DATABASE_URL=sqlite:////tmp/o.db ALLOW_NETWORK=1 .venv/bin/python -m scripts.generate_fallback` |
| Resetar tudo | `docker compose down -v && docker compose up --build` (apaga o volume do banco) |

## Arquitetura em uma frase

O backend é um **resolvedor de fontes**: cada informação do dashboard
(`next_match`, `standings`, `news`, …) tem uma fila de fontes habilitadas, cada
qual com um adapter que normaliza o payload bruto para o formato canônico
(`docs/API_CONTRACT.md`) — por isso trocar de API é configuração, não refactor.
