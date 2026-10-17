#!/usr/bin/env bash
#
# OndeJoga — atualiza a aplicação a partir do GitHub.
#
#   ./atualizar.sh
#
# Baixa o último commit do branch `main`, reconstói as imagens que mudaram e
# reinicia os serviços. Pode rodar quantas vezes quiser: sem commit novo ele
# só confirma que já está em dia, e o volume do PostgreSQL (`dbdata`) nunca é
# tocado — os dados e as contas ficam onde estão.
#
# Se houver alteração local não commitada, o script para e avisa em vez de
# correr o risco de sobrescrever trabalho seu.
#
set -euo pipefail

cd "$(dirname "$0")"

BRANCH=main
REMOTE=origin

# Cores só quando a saída é um terminal (evita escapes em log/redirecionamento).
if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi

ok()    { printf '%s✓%s %s\n'   "$GREEN"  "$RESET" "$*"; }
aviso() { printf '%s!%s %s\n'   "$YELLOW" "$RESET" "$*"; }
falha() { printf '%s✗%s %s\n'   "$RED"    "$RESET" "$*" >&2; exit 1; }

# --------------------------------------------------------------------------- #
# Pré-requisitos
# --------------------------------------------------------------------------- #
command -v git    >/dev/null 2>&1 || falha "git não encontrado neste ambiente."
command -v docker >/dev/null 2>&1 || falha "docker não encontrado neste ambiente."
docker compose version >/dev/null 2>&1 || falha "o plugin 'docker compose' não está disponível."
git rev-parse --git-dir >/dev/null 2>&1 || falha "este diretório não é um repositório git."

printf '%sOndeJoga — atualização%s\n\n' "$BOLD" "$RESET"

# --------------------------------------------------------------------------- #
# O que há de novo no GitHub
# --------------------------------------------------------------------------- #
# Árvore suja: um `--ff-only` a protegeria no pull, mas o `--build` de baixo
# embarcaria o arquivo solto na imagem — melhor avisar e parar.
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  falha "há alterações locais não commitadas — commite ou descarte antes de atualizar."
fi

git fetch --quiet "$REMOTE" "$BRANCH" \
  || falha "não consegui falar com $REMOTE/$BRANCH — confira a rede e a chave SSH."

LOCAL=$(git rev-parse HEAD)
REMOTO=$(git rev-parse "$REMOTE/$BRANCH")

if [ "$LOCAL" = "$REMOTO" ]; then
  ok "código já está em dia ($(git log --oneline -1 HEAD))."
else
  if ! git merge-base --is-ancestor "$LOCAL" "$REMOTO"; then
    falha "seu branch local divergiu do $REMOTE/$BRANCH; resolva o histórico antes de atualizar."
  fi

  aviso "baixando: $(git log --oneline -1 "$REMOTO")"
  git merge --ff-only --quiet "$REMOTO"
  ok "código atualizado para $(git log --oneline -1 HEAD)."
fi

# --------------------------------------------------------------------------- #
# Containers
# --------------------------------------------------------------------------- #
# `--build` reconstói só o que mudou (api e web têm contexto de build; o db é
# imagem pronta). `--wait` segura até os healthchecks responderem, então quando
# o script termina a aplicação já está de pé.
echo
printf '%sReconstuindo os serviços%s\n' "$BOLD" "$RESET"
docker compose up -d --build --wait

# --------------------------------------------------------------------------- #
# Situação final
# --------------------------------------------------------------------------- #
PORTA=$(docker compose port web 80 2>/dev/null | head -1 | sed 's/.*://' || true)
PORTA=${PORTA:-${APP_PORT:-3999}}

echo
docker compose ps
printf '\n%sPronto:%s http://localhost:%s\n' "$BOLD" "$RESET" "$PORTA"

# A versão vem da própria aplicação, lida do repositório dentro do container:
# é o que está de pé agora, e não o que o `git log` diz que deveria estar.
VERSAO=$(docker compose exec -T api python -c \
  "import json,urllib.request as u;d=json.load(u.urlopen('http://127.0.0.1:8000/api/health',timeout=3));print('%s · %s @ %s' % (d.get('version','?'), d.get('branch') or 'sem branch', d.get('commit') or 'sem commit'))" \
  2>/dev/null || true)
if [ -n "$VERSAO" ]; then
  printf '%sVersão:%s %s\n' "$BOLD" "$RESET" "$VERSAO"
fi
