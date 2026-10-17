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
    """Cada teste começa com os caches limpos — ambos guardam por processo."""
    version.build_info.cache_clear()
    version.reset_update_cache()
    yield
    version.build_info.cache_clear()
    version.reset_update_cache()


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


def test_health_fica_local_e_a_raiz_diz_se_ha_versao_nova(client, monkeypatch, tmp_path):
    """`/api/health` é o healthcheck dos containers: não pode depender do GitHub.

    Quem pergunta se há atualização é `GET /api`, que só o rodapé chama.
    """
    monkeypatch.setattr(version, "REPO_DIR", str(tmp_path))

    health = client.get("/api/health").json()
    info = client.get("/api").json()

    for payload in (health, info):
        assert payload["version"] == version.APP_VERSION
        assert {"commit", "branch", "tag", "dirty", "source"} <= payload.keys()

    assert "update_available" not in health
    assert info["update_available"] is None  # sem repositório: sem como saber


def test_remoto_na_mesma_estaca_diz_atualizado(monkeypatch, tmp_path):
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    head = _git_in(repo, "rev-parse", "HEAD")
    monkeypatch.setattr(version, "_remote_head", lambda: head)

    assert version.update_available() is False


def test_commit_novo_no_remoto_sinaliza_atualizacao(monkeypatch, tmp_path):
    """Remoto com SHA que nunca passou por aqui: há o que baixar."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    monkeypatch.setattr(version, "_remote_head", lambda: "a" * 40)

    assert version.update_available() is True


def test_commit_local_sem_empurrar_nao_conta_como_atualizacao(monkeypatch, tmp_path):
    """Quem está à frente é o local — dizer "atualização" aqui seria mentira."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    antigo = _git_in(repo, "rev-parse", "HEAD")

    (repo / "arquivo.txt").write_text("novo", encoding="utf-8")
    _git_in(repo, "add", "-A")
    _git_in(repo, "commit", "-q", "-m", "commit local ainda no forno")

    monkeypatch.setattr(version, "_remote_head", lambda: antigo)

    assert version.update_available() is False


def test_github_fora_nao_quebra_nada(monkeypatch, tmp_path):
    """Sem resposta do remoto a resposta é `None` — sem exceção, sem `False`."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    monkeypatch.setattr(version, "_remote_head", lambda: None)

    assert version.update_available() is None


def test_sem_repositorio_nem_vai_perguntar_ao_remoto(monkeypatch, tmp_path):
    """Sem repo local não há o que comparar: nem adianta gastar a rede."""
    monkeypatch.setattr(version, "REPO_DIR", str(tmp_path))
    chamado: list[bool] = []
    monkeypatch.setattr(version, "_remote_head", lambda: chamado.append(True) or None)

    assert version.update_available() is None
    assert chamado == []


def test_consulta_o_remoto_uma_vez_por_periodo(monkeypatch, tmp_path):
    """TTL: a resposta não muda no ritmo das atualizações de tela."""
    repo = _make_repo(tmp_path)
    monkeypatch.setattr(version, "REPO_DIR", str(repo))
    head = _git_in(repo, "rev-parse", "HEAD")
    chamadas: list[int] = []

    def _fake():
        chamadas.append(1)
        return head

    monkeypatch.setattr(version, "_remote_head", _fake)

    assert version.update_available() is False
    assert version.update_available() is False
    assert len(chamadas) == 1


def test_remoto_e_consultado_por_https_anonimo(monkeypatch):
    """O `origin` é SSH e o container não tem chave: a consulta é por HTTPS."""
    comando: list[str] = []
    sha = "b" * 40

    def _fake_run(cmd, **kwargs):
        comando.extend(cmd)
        return subprocess.CompletedProcess(
            cmd, 0, stdout=f"{sha}\trefs/heads/main\n", stderr=""
        )

    monkeypatch.setattr(version.subprocess, "run", _fake_run)

    assert version._remote_head() == sha
    assert comando[1] == "ls-remote"
    assert comando[2].startswith("https://")
