# OndeJoga ⚽

Painel do time no navegador: próximo jogo, último resultado, placar ao vivo
(enquanto o jogo roda), tabelas dos campeonatos, notícias e estatísticas.

Fiz porque queria um endereço só, na rede de casa, que abrisse no celular e na
TV da sala — sem app de terceiro, sem anúncio e sem depender de conta em site
esportivo.

Vem de fábrica apontado para o Cruzeiro (meu time). Trocar é configuração,
não código.

## Rodando

```bash
docker compose up --build
```

Abre em http://localhost:3999. Para acessar de outro aparelho da casa, use o IP
da máquina — só essa porta fica exposta:

```bash
# descobre o IP que a máquina usa na rede local (Linux)
ip -4 route get 1.1.1.1 | grep -oP 'src \K[\d.]+'
# => http://172.19.33.101:3999   (nesta máquina)
```

Porta ocupada: `APP_PORT=4000 docker compose up --build`. Não sabe se subiu
mesmo? `docker compose ps` — os três serviços têm que aparecer `healthy` — e
`docker compose logs -f api` se algo travar.

Onde fica cada coisa: painel em `/`, configurações da conta em `/#/configuracoes`,
cadastro de fontes em `/#/admin`, Swagger em `/api/docs`.

## Os três serviços

| Serviço | Imagem | O que faz | Porta |
|---|---|---|---|
| `web` | nginx | Serve o bundle do React e faz proxy de `/api` | **3999 → 80** (única exposta) |
| `api` | python:3.12-slim | FastAPI: resolve as fontes, cache, fallback, CRUD | interna (8000) |
| `db` | postgres:16-alpine | Só configuração e contas | interna (5432) |

Dado esportivo não vai pro banco. Ele vem das APIs a cada refresh e vive no
cache em memória. O PostgreSQL guarda apenas config, layout, fontes cadastradas
e usuários.

```
ondejoga/
├── docker-compose.yml      # sobe tudo (compose v2+)
├── .env.example            # variáveis opcionais
├── RESET-<usuario>.txt     # senha temporária do reset (só aparece se você pedir)
├── docs/API_CONTRACT.md    # contrato backend ↔ frontend
├── api/                    # FastAPI + provedores + testes pytest
└── web/                    # React + Vite + vitest + e2e Playwright (web/e2e)
```

## De onde vem o dado

| Fonte | Dá o quê | Chave |
|---|---|---|
| TheSportsDB | time, próximo jogo, último jogo | a grátis (`3`) |
| ESPN | calendário, estatísticas, escudos, jogo ao vivo | nenhuma |
| Wikipédia (MediaWiki) | tabelas de classificação completas | nenhuma |
| Google Notícias (RSS) | notícias | nenhuma |
| TV estático | transmissoras por competição | você quem mapeia |

Todas testadas ao vivo enquanto eu montava o painel.

## Conta, time e privacidade

A API responde sem login no escopo global, mas a interface não mostra time
nenhum para visitante: sem sessão aparece a tela de boas-vindas, com *Criar
conta* e *Já tenho conta*.

Quem se registra passa por dois passos — os dados de acesso e depois **"Qual é
o seu time?"**. Esse segundo modal não tem botão de fechar nem Escape: você
busca, clica no resultado e confirma, e só aí o painel abre. Enquanto isso não
acontece, o `GET /api/config` responde `owned: false` e o front nem chega a
chamar o dashboard. Vale para conta antiga também: entrar sem time, o portão
cobra a escolha.

Na confirmação o backend monta o time inteiro: os ids de cada provedor (cada
API tem sua própria numeração), cor, escudo, cidade e as competições do clube
(ligas do cadastro, mais Copa do Brasil automática para time brasileiro). É
isso que alimenta o widget de Tabelas.

Sobre a sessão:

- cookie httpOnly de 30 dias (`ondejoga_session`), só em `/api`;
- ao registrar você recebe uma cópia da config, do layout e das fontes — depois
  disso só você mexe no que é seu, e nada vaza para os outros usuários;
- dá para ter contas com times, cores e layouts diferentes no mesmo navegador;
- o F5 recarrega tudo no escopo da sua conta (o primeiro load é anônimo; quando
  a sessão é resolvida, config e layout recarregam).

| Ação | anônimo | logado |
|---|---|---|
| ver o dashboard | escopo global | o seu escopo |
| salvar config/layout/fontes | `401` | o seu escopo |
| `PUT /api/auth/profile` · `POST /api/auth/reset-file` · `POST /api/config/team` | `401` | a sua conta |

Pela linha de comando:

```bash
curl -c jar -X POST http://localhost:3999/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"matheus","password":"segredo123"}'
# o passo do time é feito pela interface; via API seria:
curl -b jar http://localhost:3999/api/teams/search?q=cruzeiro
curl -b jar -X POST http://localhost:3999/api/config/team \
  -H 'Content-Type: application/json' -d '{"provider":"thesportsdb","id":"134294"}'
curl -b jar http://localhost:3999/api/auth/me
curl -b jar -X POST http://localhost:3999/api/auth/logout
```

## E quando uma API cair?

API gratuita quebra, e quebra justo quando tem jogo. O resolvedor tenta as
fontes habilitadas em ordem de prioridade; se todas falharem, o dashboard cai
nos dados de backup embarcados (`api/app/data/fallback.json`) e mostra um selo
"dados de fallback" no cabeçalho. A tela não fica vazia.

Para trocar a fonte que morreu, sem tocar em código:

1. `/#/admin` → **Nova fonte** (ou `POST /api/admin/sources`) — escolha o `kind`
   (`url_json` aceita qualquer REST API com `mapping` declarativo);
2. use **Testar** e confira o payload normalizado;
3. suba a `priority` para ela assumir e desabilite a fonte quebrada.

## Personalizar

### Trocar o time

No painel, engrenagem **Configurar** → seção **Time**: busca e confirma, mesma
coisa do onboarding — o backend remonta ids, cores e competições.

Ou à mão, via `PUT /api/config` (faz merge parcial):

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

`ids` guarda o id do time em cada provedor. `competitions[].page` é o título da
página da Wikipédia com a classificação (`{season}` vira o ano corrente); sem
`page`, a competição fica de fora da seção de tabelas.

### Os cards

Em **Configurar** → **Widgets** você arrasta, reordena, renomeia, oculta, troca
tamanho, opções e cor de destaque. Por API:

```bash
curl -X PUT http://localhost:3999/api/layout -H 'Content-Type: application/json' -d '{
  "theme": { "default": "dark", "accent": "auto" },
  "widgets": [ { "id": "news", "type": "news", "title": "Notícias", "visible": false,
                 "order": 5, "size": "md", "options": { "limit": 6 } } ]
}'

curl -X POST http://localhost:3999/api/layout/reset   # volta ao padrão
```

Widgets: `my_team` (identidade do clube + estatísticas no mesmo cartão),
`next_match`, `last_match`, `live_match`, `standings`, `news`, `stats`, `form`.
Layouts gravados em versão antiga continuam aceitos (`team_header` e `stats`),
e ganham os widgets novos do padrão no fim, sem mexer no que você já
personalizou. Tamanhos: `sm`, `md`, `lg`, `full`.

Os cartões de jogo são padronizados: mesmo escudo (44px) dos dois lados, e o
placar sempre colado ao "×" (`escudo nome 2 × 0 nome escudo`), nunca junto ao
nome do clube.

O **Tempo Real** (`live_match`) só aparece enquanto o time está em campo —
placar, período/cronômetro (ex.: "87'"), estádio e o selo AO VIVO. Sem jogo ele
nem é renderizado; o front consulta `GET /api/live-match` a cada 20s com jogo
rolando e 60s parado, e a resposta é `null` quando o time não está jogando.

O **Tabelas** é navegável em abas:

- por competição — só aparecem as em que o time está ativo (as eliminadas somem
  por padrão; desligue com `hide_eliminated`);
- por fase — cada fase do mata-mata vira uma aba, sempre abrindo na fase atual
  do seu time;
- por grupo — chips "Grupo A…H" quando a fase tem várias tabelas;
- nas fases finais a tabela vira chave: confronto a confronto, com escudos,
  placar agregado, pênaltis e o vencedor destacado.

### Configurações da conta (`/#/configuracoes`)

O painel de personalização virou página inteira (antes era uma gaveta lateral),
abraçando tudo que é da conta:

| Seção | O que faz |
|---|---|
| **Conta** | trocar nome de usuário e senha (precisa da senha atual) |
| **Time** | buscar e trocar de time |
| **Aparência** | tema, cor de destaque e intervalo de refresh |
| **Widgets** | mostrar/ocultar, reordenar, renomear, tamanho, opções |
| **Atualização** | força `GET /api/dashboard?refresh=true` e restaura o layout |
| **Fontes** | o mesmo CRUD do `/#/admin`, agora no seu escopo |

#### Esqueci a senha

Não tem e-mail aqui (não quis configurar SMTP pra isso). O reset é um arquivo:
em **Conta** → *Gerar senha temporária*, confirme, e o backend gera a senha,
grava `RESET-<usuario>.txt` na raiz da pasta do projeto e troca a senha da
conta, derrubando as outras sessões. O arquivo é gravado antes da troca — se
algo falhar no meio, sua senha continua valendo.

O `RESET-*.txt` nasce com dono igual ao da pasta e modo `0600`, então dá para
ler no host sem `sudo` (no Docker a pasta do projeto é o volume). Ele já está
no `.gitignore`.

```text
OndeJoga — senha temporária
===========================
Usuário: matheus
Senha temporária: 42c6-eed2-4720-ca4b
Gerado em: 2026-10-12 00:08:00 UTC

Entre no OndeJoga com essa senha e troque-a em Configurações → Conta.
Depois de usar, apague este arquivo.
```

Quem prefere API: `POST /api/auth/reset-file`, que devolve arquivo e senha.

### Tema

A cor vem do time: claro e escuro são derivados de `team.primary_color`, com
contraste calculado (nada de azul ilegível sobre branco). `accent: "auto"` é o
padrão e segue o time; se você escolher uma cor na tela, ela fica fixa.
Escuro/claro pelo botão do cabeçalho (guardado no navegador), e
`layout.theme.default` (`system` | `light` | `dark`) define o padrão para quem
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

Rodem offline — rede bloqueada, banco SQLite temporário —, então nada depende
de internet para passar.

```bash
# Backend (152 testes: contas, escopo por usuário, busca/seleção de time,
# perfil + reset por arquivo, resolução de fontes, cache, fallback, CRUD,
# providers, fase de copa, chaves de mata-mata, jogo ao vivo, API)
cd api
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest

# Frontend (58 testes: widgets, abas de competição/fase, chaves, tema derivado
# do time, onboarding com escolha obrigatória de time, tela de Configurações,
# admin, cliente HTTP, Tempo Real)
cd web
npm install
npm test        # vitest
npm run build   # checagem de tipos + build de produção

# E2E (Playwright, 11 cenários contra o stack de verdade: portão, registro +
# escolha de time, painel, tela de Configurações e reset por arquivo)
npm run test:e2e:install                  # uma vez: baixa o Chromium
docker compose up -d --build              # stack em http://localhost:3999
npm run test:e2e                          # E2E_BASE_URL p/ outra porta/host
```

### Tailwind, se quiser

Os estilos legados continuam em CSS puro, com as variáveis do tema. Para tela
nova dá para usar Tailwind v4: `@tailwindcss/vite` está ligado no
`vite.config.ts` e o `web/src/styles/tailwind.css` define só `@theme` +
`@utilities`, sem preflight — ou seja, o visual atual não muda. `@source` varre
`src/**/*.{ts,tsx}`, então é só escrever as classes nos arquivos novos.

## Quando der ruim

| Sintoma | O que fazer |
|---|---|
| `port is already allocated` | `APP_PORT=4000 docker compose up --build` |
| Dashboard mostra "dados de fallback" | Uma ou mais fontes fora. Confira em `/#/admin` → **Status** ou `GET /api/admin/status` |
| `api` reiniciando | `docker compose logs api` — quase sempre é o banco: `docker compose logs db` |
| Quer regenerar o backup offline | `cd api && DATABASE_URL=sqlite:////tmp/o.db ALLOW_NETWORK=1 .venv/bin/python -m scripts.generate_fallback` |
| Resetar tudo | `docker compose down -v && docker compose up --build` (apaga o volume do banco) |

## Como funciona por dentro

O backend é um resolvedor de fontes: cada informação do dashboard
(`next_match`, `standings`, `news`, …) tem uma fila de fontes habilitadas, e
cada fonte tem um adapter que normaliza o payload bruto para o formato
canônico descrito em [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Por isso
trocar de API é configuração, não refatoração.
