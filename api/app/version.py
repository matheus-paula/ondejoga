"""Versão da aplicação: o que está de pé e se há versão nova lá fora.

O Pi-hole responde `pihole -v` lendo o próprio repositório, e é o mesmo esquema
aqui: o `docker-compose.yml` monta a raiz do projeto no container da API
(`.:/ondejoga`), então a aplicação enxerga o `.git` e diz exatamente qual
commit está rodando — sem ninguém precisar lembrar de subir um número.

Dois números convivem, como no Pi-hole:

- **release** (`APP_VERSION`, em `config.py`): muda quando se corta uma
  release; é o número que o humano reconhece;
- **commit / branch / tag**: vêm do git e mudam sozinhos a cada commit, para
  saber o que está de pé sem depender da memória de ninguém.

`update_available()` completa a figura comparando com o remoto, para o rodapé
dizer se existe versão nova para baixar.

Sem repositório montado — testes, `uvicorn` direto, deploy feito de um tarball
— a resposta cai para a release e o resto vem vazio. Nunca uma exceção: isto é
chamado dentro de um request.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from functools import lru_cache
from typing import Any

from .config import APP_VERSION

# Raiz do projeto, montada pelo `docker-compose.yml`. Fora do container, aponte
# para o repositório com `APP_REPO_DIR` (ou deixe e receba só a release).
REPO_DIR = os.getenv("APP_REPO_DIR", "/ondejoga")

# O `origin` é SSH (`git@github.com`) e o container não tem chave, então a
# checagem de atualização vai pelo HTTPS do repositório público — anônimo,
# sem segredo dentro da imagem e sem limite de chamadas.
UPDATE_REMOTE = os.getenv(
    "APP_UPDATE_REMOTE", "https://github.com/matheus-paula/ondejoga.git"
)
UPDATE_BRANCH = "main"

# Resposta definitiva vale 10 min (a resposta só muda no ritmo dos commits, e
# ninguém deve remarcar o GitHub a cada F5); "não deu para saber" — rede
# fora do ar — dura 1 min, para recuperar rápido quando a rede voltar.
UPDATE_TTL = 600.0
UPDATE_TTL_UNKNOWN = 60.0
# Nunca segurar um request por causa do GitHub. Medido: ~0,5 s com a rede boa
# e ~0,03 s quando o host nem responde.
UPDATE_TIMEOUT = 6.0

_UPDATE_LOCK = threading.Lock()
_UPDATE: dict[str, Any] = {"until": 0.0, "value": None}


def _run_git(
    args: tuple[str, ...], *, timeout: float = 5, check: bool = True
) -> subprocess.CompletedProcess | None:
    """Roda `git` no repositório montado; `None` quando nem chegou a rodar.

    - `safe.directory` porque o container roda como root e o repositório é do
      usuário do host: sem a exceção o git se recusa a olhar ("dubious
      ownership") e cairíamos na release sem saber por quê;
    - `GIT_OPTIONAL_LOCKS=0` para não disputar o lock do repositório com um
      `git` que esteja rodando no host pelo mesmo caminho;
    - `GIT_TERMINAL_PROMPT=0` para nunca parar pedindo credencial.
    """
    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        return None
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}
    try:
        return subprocess.run(
            ["git", "-c", f"safe.directory={REPO_DIR}", *args],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=check,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _git(*args: str) -> str | None:
    """Saída do `git` sem quebra de linha; `None` em qualquer falha."""
    result = _run_git(args)
    if result is None or result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _git_code(*args: str) -> int | None:
    """Código de saída do `git`; `None` quando nem chegou a rodar.

    Preciso do número em vez da saída porque `merge-base --is-ancestor`
    distingue "é ancestral" (saída 0) de "não é" (saída 1) — e aqui são
    respostas opostas.
    """
    result = _run_git(args, check=False)
    if result is None:
        return None
    return result.returncode


def _remote_head() -> str | None:
    """SHA publicado para `main` no remoto, sem credencial nenhuma.

    `git ls-remote` em URL não toca no repositório local, então roda fora dele
    — sem `safe.directory`, sem lock, sem risco de bagunçar nada.
    """
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            ["git", "ls-remote", UPDATE_REMOTE, f"refs/heads/{UPDATE_BRANCH}"],
            capture_output=True,
            text=True,
            timeout=UPDATE_TIMEOUT,
            check=True,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    campos = result.stdout.split()
    return campos[0] if campos else None


def _tem_atualizacao() -> bool | None:
    """`True` quando o remoto tem commit que esta máquina ainda não tem."""
    local = _git("rev-parse", "HEAD")
    if local is None:
        # Sem repositório não há o que comparar — e nem vá perguntar ao
        # GitHub: a rede não resolve a falta do repo.
        return None
    remoto = _remote_head()
    if remoto is None:
        return None
    if remoto == local:
        return False

    # Tenho o objeto do remoto? Se não, é commit que nunca chegou aqui.
    tem_objeto = _git_code("cat-file", "-e", f"{remoto}^{{commit}}")
    if tem_objeto is None:
        return None
    if tem_objeto != 0:
        return True

    # O remoto é ancestral de mim? Então quem está à frente sou eu e não há
    # nada para baixar — é o caso de quem acabou de commitar sem empurrar.
    codigo = _git_code("merge-base", "--is-ancestor", remoto, local)
    if codigo is None:
        return None
    return codigo != 0


def update_available() -> bool | None:
    """Diz se há versão nova para baixar; `None` quando não dá para saber.

    Guardado sob lock com TTL: uma consulta por período, e quem chegar
    enquanto o git conversa com o GitHub espera a mesma resposta em vez de
    disparar outra consulta. `None` (rede fora) vale menos para recuperar
    assim que a rede voltar.
    """
    with _UPDATE_LOCK:
        agora = time.monotonic()
        if agora < _UPDATE["until"]:
            return _UPDATE["value"]
        valor = _tem_atualizacao()
        _UPDATE["value"] = valor
        _UPDATE["until"] = agora + (UPDATE_TTL if valor is not None else UPDATE_TTL_UNKNOWN)
        return valor


def reset_update_cache() -> None:
    """Descarta a resposta guardada — usado pelos testes."""
    with _UPDATE_LOCK:
        _UPDATE.update(until=0.0, value=None)


@lru_cache(maxsize=1)
def build_info() -> dict[str, Any]:
    """Release + git do commit em execução, calculados uma vez por processo.

    Fica em cache de propósito: o commit não muda enquanto o processo vive, e
    `git status` varre a árvore inteira. Quem atualizar o código reinicia o
    container (`atualizar.sh` faz isso), e aí o cache nasce de novo.
    """
    commit = _git("rev-parse", "--short", "HEAD")
    has_repo = commit is not None
    return {
        "version": APP_VERSION,
        "commit": commit,
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD") if has_repo else None,
        # `--always` devolve o hash mesmo sem tag nenhuma; `--dirty` avisa
        # quando a árvore local tem alteração não commitada — informação de
        # quem está desenvolvendo, não do que está em produção.
        "tag": _git("describe", "--tags", "--always", "--dirty") if has_repo else None,
        "dirty": bool(_git("status", "--porcelain")) if has_repo else False,
        "source": "git" if has_repo else "release",
    }
