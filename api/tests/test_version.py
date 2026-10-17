"""Versão da aplicação: a release versionada e o commit que está de pé.

A API resolve `/api/health` lendo o repositório que o `docker-compose.yml`
monta no container — mesmo esquema do `pihole -v`. Aqui provamos os dois
caminhos: com git (commit/branch/dirty preenchidos) e sem (só a release, sem
uma única exceção).
"""
from __future__ import annotations

import subprocess

import pytest

from app import version


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Cada teste começa com o cache limpo — ele guarda o resultado por processo."""
    version.build_info.cache_clear()
    yield
    version.build_info.cache_clear()


def _git_in(path, *args: str) -> str:
    """Roda um `git` real numa pasta temporária (o host de teste tem git)."""
    return subprocess.run(
        ["git", *args], cwd=path, capture_output=True, text=True,
        check=True, env={"PATH": "/usr/bin:/bin:/usr/local/bin"},
    ).stdout.strip()


def _make_repo(tmp_path):
    """Repositório mínimo e rastreado: devolve o caminho."""
    _git_in(tmp_path, "init", "-q", "-b", "main")
    _git_in(tmp_path, "config", "user.email", "teste@example.com")
    _git_in(tmp_path, "config", "user.name", "Teste")
    (tmp_path / "arquivo.txt").write_text("oi", encoding="utf-8")
    _git_in(tmp_path, "add", "-A")
    _git_in(tmp_path, "commit", "-q", "-m", "primeiro")
    return tmp_path


def test_sem_repositorio_devolve_so_a_release(monkeypatch, tmp_path):
    """Sem `.git` em volta: só a release, `source` marcado como `release`."""
    monkeypatch.setattr(version, "REPO_DIR", str(tmp_path))

    info = version.build_info()

    assert info["version"] == version.APP_VERSION
    assert info["source"] == "release"
    assert info["commit"] is None
    assert info["branch"] is None
    assert info["dirty"] is False


def test_com_repositorio_devolve_commit_e_branch(monkeypatch, tmp_path):
    """Com o repositório montado, o commit exato vem do git — a cada commit."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))

    info = version.build_info()

    assert info["source"] == "git"
    assert info["commit"] == _git_in(repo, "rev-parse", "--short", "HEAD")
    assert info["branch"] == "main"
    # `tag` sempre alguma coisa: sem tag nenhuma `--always` devolve o hash.
    assert info["tag"]


def test_arvore_suja_aparece_como_dirty(monkeypatch, tmp_path):
    """Árvore alterada depois do último commit é sinal de build não publicado."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    assert version.build_info()["dirty"] is False

    (repo / "arquivo.txt").write_text("mudou", encoding="utf-8")
    version.build_info.cache_clear()

    assert version.build_info()["dirty"] is True


def test_git_quebrado_cai_para_release_sem_excecao(monkeypatch, tmp_path):
    """`git` ausente ou falhando não pode estourar dentro do health check."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))

    def _explode(*args, **kwargs):
        raise OSError("git não encontrado")

    monkeypatch.setattr(version.subprocess, "run", _explode)

    info = version.build_info()

    assert info["source"] == "release"
    assert info["commit"] is None
    assert info["dirty"] is False


def test_git_recebe_a_excecao_de_propriedade_do_repositorio(monkeypatch, tmp_path):
    """O container roda como root e o repositório é do usuário do host.

    Sem `safe.directory` o git se recusa a olhar ("dubious ownership") e a
    versão cairia na release sem ninguém entender o motivo.
    """
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))

    chamada: list[str] = []

    def _fake_run(cmd, **kwargs):
        chamada.extend(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="abc1234\n", stderr="")

    monkeypatch.setattr(version.subprocess, "run", _fake_run)

    assert version.build_info()["commit"] == "abc1234"
    assert chamada[:3] == ["git", "-c", f"safe.directory={repo}"]


def test_health_e_raiz_publicam_a_versao(client):
    """Os dois endpoints expõem release + commit com o mesmo formato."""
    health = client.get("/api/health").json()
    info = client.get("/api").json()

    for payload in (health, info):
        assert payload["version"] == version.APP_VERSION
        assert {"commit", "branch", "tag", "dirty", "source"} <= payload.keys()
