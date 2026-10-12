# OndeJoga — Web (frontend)

Painel do time em React 18 + TypeScript + Vite. Sem framework de UI: CSS puro com variáveis de tema.

## Requisitos

- Node 20+ e npm

## Como rodar

```bash
npm install        # instala dependências
npm run dev        # servidor de desenvolvimento em http://localhost:5173 (proxy /api -> http://localhost:8000)
npm test           # roda os testes (Vitest + Testing Library + jsdom)
npm run build      # checagem de tipos (tsc) + build de produção em dist/
npm run preview    # serve o build de produção localmente
```

## Estrutura

- `src/api/` — cliente HTTP e tipos (contrato em `docs/API_CONTRACT.md`)
- `src/context/` — `useTheme`, `useLayout` e `useDashboard` (React context + hooks)
- `src/components/widgets/` — um componente por tipo de widget (`next_match`, `standings`, …)
- `src/components/layout/` — header, grade de widgets e drawer "Personalizar"
- `src/views/` — `Dashboard` (rota padrão) e `Admin` (rota `#/admin`, CRUD de fontes de API)
- `src/styles/` — CSS (tokens, base, layout, widgets, admin)

## Rotas

- `/` — painel do time
- `#/admin` — administração das fontes de dados (GET/POST/PUT/DELETE `/api/admin/sources`)
