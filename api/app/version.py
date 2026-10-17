"""Versão da aplicação: a release versionada e o commit exato que está de pé.

O Pi-hole responde `pihole -v` lendo o próprio repositório, e é o mesmo esquema
aqui: o `docker-compose.yml` monta a raiz do projeto no container da API
(`.:/ondejoga`), então a aplicação enxerga o `.git` e diz exatamente qual
commit está rodando — sem ninguém precisar lembrar de subir um número.

Dois números convivem, como no Pi-hole:

- **release** (`APP_VERSION`, em `config.py`): muda quando se corta uma
  release; é o número que o humano reconhece;
- **commit / branch / tag**: vêm do git e mudam sozinhos a cada commit, para
  saber o que está de pé sem depender da memória de ninguém.

Sem repositório montado — testes, `uvicorn` direto, deploy feito de um tarball
— a resposta cai para a release e o resto vem vazio. Nunca uma exceção: isto é
chamado dentro de um request de saúde.
"""
from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from typing import Any

from .config import APP_VERSION

# Raiz do projeto, montada pelo `docker-compose.yml`. Fora do container, aponte
# para o repositório com `APP_REPO_DIR` (ou deixe e receba só a release).
REPO_DIR = os.getenv("APP_REPO_DIR", "/ondejoga")


def _git(*args: str) -> str | None:
    """Roda `git` no repositório montado; `None` quando não dá para saber.

    - `safe.directory` porque o container roda como root e o repositório é do
      usuário do host: sem a exceção o git se recusa a olhar ("dubious
      ownership") e cairíamos na release sem saber por quê;
    - `GIT_OPTIONAL_LOCKS=0` para não disputar o lock do repositório com um
      `git` que esteja rodando no host pelo mesmo caminho;
    - `GIT_TERMINAL_PROMPT=0` para nunca parar pedindo credencial;
    - timeout curto: isto roda dentro de um request.
    """
    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        return None
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            ["git", "-c", f"safe.directory={REPO_DIR}", *args],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


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
        # quando a árvore local tem alteração não commitada — sinal de que o
        # que está de pé não veio de um commit.
        "tag": _git("describe", "--tags", "--always", "--dirty") if has_repo else None,
        "dirty": bool(_git("status", "--porcelain")) if has_repo else False,
        "source": "git" if has_repo else "release",
    }
