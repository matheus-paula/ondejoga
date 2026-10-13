"""O que sai do backend em inglês deve sair em português.

A API de terceiros não fala português, e o painel fala. Estes testes travam a
fronteira: código de estado vira rótulo, nome de competição vira nome em
português, e o que não é reconhecido passa adiante sem ser inventado.
"""
from __future__ import annotations

import pytest

from app.labels import (
    competition_label,
    translate_competition,
    translate_status,
)
from app.schemas import CompetitionRef, FormResult, Match, SeasonLine


@pytest.mark.parametrize(
    ("raw", "esperado"),
    [
        # a TheSportsDB e a API-Football mandam sigla
        ("HT", "Intervalo"),
        ("FT", "Encerrado"),
        ("NS", "Não iniciado"),
        ("1H", "1º tempo"),
        ("2H", "2º tempo"),
        ("AET", "Após prorrogação"),
        ("PEN", "Nos pênaltis"),
        ("PST", "Adiado"),
        # a football-data manda palavra
        ("FINISHED", "Encerrado"),
        ("PAUSED", "Intervalo"),
        ("IN_PLAY", "Ao vivo"),
        ("POSTPONED", "Adiado"),
        # a ESPN manda texto livre
        ("Halftime", "Intervalo"),
        ("Final/OT", "Após prorrogação"),
        # caixa e espaço não atrapalham a casa
        ("  ht ", "Intervalo"),
    ],
)
def test_estado_do_jogo_sai_em_portugues(raw: str, esperado: str) -> None:
    assert translate_status(raw) == esperado


@pytest.mark.parametrize(
    "raw",
    [
        None,  # sem estado nenhum
        "",  # vazio
        "48'",  # minuto do jogo — a ESPN usa no lugar do estado
        "7:30 PM ET",  # horário no campo de estado
        "ESTADO_NOVO_QUALQUER",  # fonte que a gente ainda não conhece
    ],
)
def test_o_que_nao_e_reconhecido_passa_adiante(raw: str | None) -> None:
    """Inventar tradução seria pior que devolver o texto da fonte."""
    assert translate_status(raw) == raw


@pytest.mark.parametrize(
    ("id_", "raw", "esperado"),
    [
        # pelo id, que é o que não muda entre fontes
        ("4351", "Brazilian Serie A", "Brasileirão Série A"),
        ("4724", "CONMEBOL Copa Sudamericana", "Copa Sul-Americana"),
        # id desconhecido: cai no nome em inglês
        ("bra.1", "Brazilian Serie A", "Brasileirão Série A"),
        (None, "CONMEBOL Sudamericana", "Copa Sul-Americana"),
        # nome que já é português não deve ser estragado
        ("4725", "Copa do Brasil", "Copa do Brasil"),
        # tipo de temporada que a ESPN usa como se fosse competição
        (None, "Regular Season", "Temporada regular"),
    ],
)
def test_nome_da_competicao_sai_em_portugues(
    id_: str | None, raw: str, esperado: str
) -> None:
    assert translate_competition(id_, raw) == esperado


def test_competicao_sem_nome_nem_id_vira_o_campo_padrao() -> None:
    assert competition_label(None, None) == "Competição"
    assert competition_label(None, "") == "Competição"


def test_competicao_conhecida_nao_depende_do_nome_da_fonte() -> None:
    """Duas fontes escrevem o mesmo campeonato de jeitos diferentes."""
    nomes = ["Brazilian Serie A", "brazilian série a", "  BRAZILIAN   SERIE A "]
    assert {translate_competition("4351", nome) for nome in nomes} == {"Brasileirão Série A"}


@pytest.mark.parametrize(
    ("raw", "esperado"),
    [
        # a ESPN escreve "Brasileiro" e coloca o ano na frente
        ("Brasileiro Serie A", "Brasileirão Série A"),
        ("2026 Brasileiro Serie A", "2026 Brasileirão Série A"),
        # o ano não autoriza a traduzir o que veio depois dele
        ("2026 Copa dos Campeões", "2026 Copa dos Campeões"),
    ],
)
def test_ano_no_nome_nao_atrapalha_a_traducao(raw: str, esperado: str) -> None:
    assert translate_competition(None, raw) == esperado


# --------------------------------------------------------------------------- #
# O limite de verdade: os modelos, e não só a função
# --------------------------------------------------------------------------- #
def test_competicao_no_payload_sai_em_portugues_pelo_id() -> None:
    ref = CompetitionRef.model_validate({"id": "4351", "name": "Brazilian Serie A"})
    assert ref.name == "Brasileirão Série A"


def test_backup_embarcado_tambem_sai_em_portugues() -> None:
    """O `fallback.json` entra por `model_validate` — e tem inglês guardado."""
    jogo = Match.model_validate(
        {
            "id": "2398483",
            "competition": {"id": "4351", "name": "Brazilian Serie A"},
            "home": {"name": "Bragantino"},
            "away": {"name": "Cruzeiro"},
            "status": "NS",
        }
    )
    assert jogo.status == "Não iniciado"
    assert jogo.competition.name == "Brasileirão Série A"


def test_estatisticas_tambem_saiem_em_portugues() -> None:
    linha = SeasonLine.model_validate({"competition": "2026 Brasileiro Serie A"})
    assert linha.competition == "2026 Brasileirão Série A"

    jogo = FormResult.model_validate({"opponent": "Santos", "competition": "Brazilian Serie A"})
    assert jogo.competition == "Brasileirão Série A"
