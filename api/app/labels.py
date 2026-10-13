"""Rótulos em português para o que chega em inglês das APIs de terceiros.

Nenhuma fonte fala português: a TheSportsDB manda `HT`, a football-data manda
`FINISHED`, a ESPN manda `Brazilian Serie A`. O painel é em português, então o
idioma é resolvido aqui, na hora de virar payload — os schemas chamam isto nos
seus validadores, o que cobre tanto os provedores quanto o backup embarcado.

Traduzir dentro de cada provedor traria um problema prático: os códigos também
são usados como código. Um provedor decide se um jogo terminou olhando
`FINISHED`, e o `is_live` nasce de olhar o estado do jogo. Se o provedor já
entregasse "Encerrado", essa lógica teria que comparar string em português — e
quebraria na primeira tradução mal feita. Aqui os códigos continuam códigos;
só o que o cliente vê muda de idioma.
"""
from __future__ import annotations

import re

# --------------------------------------------------------------------------- #
# Estado do jogo
# --------------------------------------------------------------------------- #
# A TheSportsDB e a API-Football usam as siglas curtas; a football-data usa
# palavras; a ESPN entrega texto livre ("7:30 PM ET", "Final/OT"). Três
# famílias, um mapa só — o que não casa passa adiante como veio.
STATUS_PT: dict[str, str] = {
    # siglas curtas (TheSportsDB · API-Football)
    "NS": "Não iniciado",
    "TBD": "A definir",
    "1H": "1º tempo",
    "HT": "Intervalo",
    "BT": "Intervalo",
    "2H": "2º tempo",
    "ET": "Prorrogação",
    "P": "Pênaltis",
    "FT": "Encerrado",
    "FT_P": "Encerrado",
    "TSTD": "Encerrado",
    "AET": "Após prorrogação",
    "PEN": "Nos pênaltis",
    "LIVE": "Ao vivo",
    "PST": "Adiado",
    "CANC": "Cancelado",
    "ABAN": "Interrompido",
    "ABD": "Abandonado",
    "SUSP": "Suspenso",
    "AWD": "Decidido fora de campo",
    # football-data.org
    "SCHEDULED": "Agendado",
    "TIMED": "Horário definido",
    "IN_PLAY": "Ao vivo",
    "PAUSED": "Intervalo",
    "FINISHED": "Encerrado",
    "SUSPENDED": "Suspenso",
    "POSTPONED": "Adiado",
    "CANCELLED": "Cancelado",
    "AWARDED": "Decidido fora de campo",
    # texto livre da ESPN (shortDetail / description)
    "HALFTIME": "Intervalo",
    "HALF TIME": "Intervalo",
    "SECOND HALF": "2º tempo",
    "FIRST HALF": "1º tempo",
    "FULL TIME": "Encerrado",
    "FINAL": "Encerrado",
    "FINAL/OT": "Após prorrogação",
    "FINAL/2OT": "Após prorrogação",
    "END OF REGULATION": "Fim do tempo regulamentar",
    "OVERTIME": "Prorrogação",
    "DELAYED": "Adiado",
    # a ESPN usa as mesmas palavras da football-data (SUSPENDED, CANCELLED,
    # POSTPONED, IN_PLAY), então já estão cobertas acima.
}


def translate_status(value: str | None) -> str | None:
    """Devolve o estado do jogo em português; o que não reconhecer, passa adiante."""
    if not value:
        return value
    text = value.strip()
    # A ESPN também manda horário por extenso ("7:30 PM ET") no mesmo campo.
    # Ele não está no mapa, então já sai como veio — sem precisar tratar à parte.
    return STATUS_PT.get(text.upper()) or value


# --------------------------------------------------------------------------- #
# Competição
# --------------------------------------------------------------------------- #
# Traduzir pelo **id** e não pelo nome: o id é o que não muda. O nome vem de
# cada provedor no seu idioma ("Brazilian Serie A" na TheSportsDB, "CONMEBOL
# Copa Sudamericana" às vezes, "Copa Sul-Americana" na Wikipédia), e o mesmo
# campeonato aparece escrito de três jeitos. Estes ids são os da TheSportsDB,
# que é a fonte de ids do app.
COMPETITION_NAMES_PT: dict[str, str] = {
    "4351": "Brasileirão Série A",
    "4404": "Brasileirão Série B",
    "4625": "Brasileirão Série C",
    "4725": "Copa do Brasil",
    "4501": "Copa Libertadores",
    "4724": "Copa Sul-Americana",
}

# Rede de segurança para quando o id não está no mapa acima — fonte nova, ou
# provedor que só manda o nome. Chave é o nome em inglês já normalizado.
_COMPETITION_BY_NAME_PT: dict[str, str] = {
    "brazilian serie a": "Brasileirão Série A",
    "brazilian série a": "Brasileirão Série A",
    "brazilian serie b": "Brasileirão Série B",
    "brazilian série b": "Brasileirão Série B",
    "brazilian serie c": "Brasileirão Série C",
    "brazilian série c": "Brasileirão Série C",
    # a ESPN escreve "Brasileiro" em vez de "Brazilian"
    "brasileiro serie a": "Brasileirão Série A",
    "brasileiro série a": "Brasileirão Série A",
    "brasileiro serie b": "Brasileirão Série B",
    "brasileiro serie c": "Brasileirão Série C",
    "brazil cup": "Copa do Brasil",
    "copa do brasil": "Copa do Brasil",
    "conmebol libertadores": "Copa Libertadores",
    "conmebol copa libertadores": "Copa Libertadores",
    "copa libertadores": "Copa Libertadores",
    "libertadores da américa": "Copa Libertadores",
    "conmebol sudamericana": "Copa Sul-Americana",
    "conmebol copa sudamericana": "Copa Sul-Americana",
    "copa sudamericana": "Copa Sul-Americana",
    "copa sul-americana": "Copa Sul-Americana",
    # tipo de temporada que a ESPN usa no lugar do nome do campeonato
    "regular season": "Temporada regular",
    "playoffs": "Mata-mata",
    "pre-season": "Pré-temporada",
}

_FALLBACK = "Competição"

# A ESPN às vezes entrega o ano colado no nome ("2026 Brasileiro Serie A").
# O ano é informação boa; traduzimos é o resto.
_YEAR_FIRST = re.compile(r"^(\d{4})\s+(\D.*)$")


def _name_key(value: str) -> str:
    """Como as chaves do mapa acima: minúsculas e espaços colapsados."""
    return " ".join(value.split()).casefold()


def translate_competition(id_: str | None, name: str | None) -> str | None:
    """Nome da competição em português, preferindo o id e caindo no nome."""
    if id_ and (by_id := COMPETITION_NAMES_PT.get(str(id_).strip())):
        return by_id
    if not name:
        return None

    text = " ".join(name.split())
    year, rest = "", text
    if match := _YEAR_FIRST.match(text):
        year, rest = f"{match.group(1)} ", match.group(2)

    translated = _COMPETITION_BY_NAME_PT.get(_name_key(rest))
    return f"{year}{translated}" if translated else text


def competition_label(id_: str | None, name: str | None) -> str:
    """Igual a :func:`translate_competition`, mas sempre com um nome para mostrar."""
    return translate_competition(id_, name) or _FALLBACK
