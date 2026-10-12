"""Busca/seleção de time (onboarding) e recursos de conta (perfil/reset).

A rede é bloqueada no ambiente de teste (`ALLOW_NETWORK=0`); os JSONs da
TheSportsDB/ESPN são simulados trocando `app.services.teams._get_json`.
"""
from __future__ import annotations

from app.services import teams as teams_service

# --------------------------------------------------------------------------- #
# Fixtures de payload (formato real das fontes)
# --------------------------------------------------------------------------- #
SEARCH_PAYLOAD = {
    "teams": [
        {
            "idTeam": "134294",
            "strTeam": "Cruzeiro",
            "strTeamShort": "CRU",
            "strSport": "Soccer",
            "strBadge": "https://img.example/cruzeiro.png",
            "strCountry": "Brazil",
            "strLeague": "Brazilian Serie A",
        },
        {
            # outro esporte: não pode aparecer nos resultados
            "idTeam": "900001",
            "strTeam": "Cruzeiro Baseball Club",
            "strSport": "Baseball",
        },
        {
            "idTeam": "133604",
            "strTeam": "Palmeiras",
            "strTeamShort": "PAL",
            "strSport": "Soccer",
            "strBadge": "https://img.example/palmeiras.png",
            "strCountry": "Brazil",
            "strLeague": "Brazilian Serie A",
        },
    ]
}

LOOKUPS: dict[str, dict] = {
    "134294": {
        "teams": [
            {
                "idTeam": "134294",
                "strTeam": "Cruzeiro",
                "strTeamShort": "CRU",
                "strSport": "Soccer",
                "strLeague": "Brazilian Serie A",
                "idLeague": "4351",
                "strLocation": "Belo Horizonte",
                "strColour1": "#2F529E",
                "strColour2": "#FFFFFF",
                "strBadge": "https://img.example/cruzeiro.png",
                "strCountry": "Brazil",
            }
        ]
    },
    "133604": {
        "teams": [
            {
                "idTeam": "133604",
                "strTeam": "Palmeiras",
                "strTeamShort": "PAL",
                "strSport": "Soccer",
                "strLeague": "Brazilian Serie A",
                "idLeague": "4351",
                "strLocation": "São Paulo",
                "strColour1": "#006437",
                "strColour2": "#FFFFFF",
                "strBadge": "https://img.example/palmeiras.png",
                "strCountry": "Brazil",
            }
        ]
    },
    "4040": {"teams": None},
}

ESPN_PAYLOAD = {
    "sports": [
        {
            "leagues": [
                {
                    "teams": [
                        {"team": {"id": "2022", "displayName": "Cruzeiro", "color": "2F529E"}},
                    ]
                }
            ]
        }
    ]
}


def fake_get_json(url: str, params: dict | None = None) -> dict:
    if "searchteams.php" in url:
        return SEARCH_PAYLOAD
    if "lookupteam.php" in url:
        return LOOKUPS.get(str((params or {}).get("id")), {"teams": None})
    if url.endswith("/teams"):
        return ESPN_PAYLOAD
    raise AssertionError(f"URL inesperada: {url}")


def patch_network(monkeypatch) -> None:
    monkeypatch.setattr(teams_service, "_get_json", fake_get_json)


# --------------------------------------------------------------------------- #
# Busca de times
# --------------------------------------------------------------------------- #
def test_busca_filtra_esportes_e_devolve_formato(client, monkeypatch):
    patch_network(monkeypatch)
    response = client.get("/api/teams/search", params={"q": "cruzeiro"})
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "cruzeiro"
    ids = [item["id"] for item in body["results"]]
    assert ids == ["134294", "133604"]  # só futebol (o de baseball cai fora)
    assert body["results"][0] == {
        "provider": "thesportsdb",
        "id": "134294",
        "name": "Cruzeiro",
        "short_name": "CRU",
        "logo": "https://img.example/cruzeiro.png",
        "country": "Brazil",
        "league": "Brazilian Serie A",
    }


def test_busca_exige_pelo_menos_dois_caracteres(client, monkeypatch):
    patch_network(monkeypatch)
    response = client.get("/api/teams/search", params={"q": "c"})
    assert response.status_code == 422


def test_busca_falha_de_fonte_vira_erro_amigavel(client, monkeypatch):
    def boom(url: str, params: dict | None = None) -> dict:
        raise teams_service.TeamsError("a fonte de times respondeu HTTP 500", 502)

    monkeypatch.setattr(teams_service, "_get_json", boom)
    response = client.get("/api/teams/search", params={"q": "cruzeiro"})
    assert response.status_code == 502
    assert "HTTP 500" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# Escolha do time
# --------------------------------------------------------------------------- #
def test_escolher_time_exige_conta(client, monkeypatch):
    patch_network(monkeypatch)
    response = client.post("/api/config/team", json={"provider": "thesportsdb", "id": "134294"})
    assert response.status_code == 401


def test_registro_sem_time_fica_com_owned_false(auth_client):
    status = auth_client.get("/api/auth/me")
    assert status.json()["user"]["team_name"] == ""
    config = auth_client.get("/api/config").json()
    assert config["owned"] is False
    # mesmo sem time escolhido, o painel continua com o padrão herdado
    assert config["team"]["name"] == "Cruzeiro"


def test_escolher_time_salva_config_e_atualiza_conta(auth_client, monkeypatch):
    patch_network(monkeypatch)
    response = auth_client.post(
        "/api/config/team", json={"provider": "thesportsdb", "id": "134294"}
    )
    assert response.status_code == 200
    config = response.json()
    assert config["owned"] is True
    assert config["team"]["name"] == "Cruzeiro"
    assert config["team"]["city"] == "Belo Horizonte"
    assert config["team"]["primary_color"] == "#2F529E"
    assert config["team"]["ids"] == {
        "thesportsdb": "134294",
        "espn": "2022",  # descoberto pela listagem da liga na ESPN
        "espn_league": "bra.1",
        "football_data": "",
        "api_football": "",
    }
    # conta ganha o nome do time; a escolha fica salva
    assert auth_client.get("/api/auth/me").json()["user"]["team_name"] == "Cruzeiro"
    assert auth_client.get("/api/config").json()["owned"] is True


def test_trocar_de_time_refaz_competicoes_e_limpa_ids(auth_client, monkeypatch):
    patch_network(monkeypatch)
    auth_client.post("/api/config/team", json={"provider": "thesportsdb", "id": "134294"})

    response = auth_client.post(
        "/api/config/team", json={"provider": "thesportsdb", "id": "133604"}
    )
    assert response.status_code == 200
    team = response.json()["team"]
    assert team["name"] == "Palmeiras"
    # competições recalculadas: liga principal + Copa do Brasil (time brasileiro)
    assert [(c["id"], c["name"]) for c in team["competitions"]] == [
        ("4351", "Brasileirão Série A"),
        ("4725", "Copa do Brasil"),
    ]
    # ids do time anterior não sobrevivem
    assert team["ids"]["espn"] == ""  # a ESPN não tem Palmeiras nessa liga fictícia


def test_mesmo_time_preserva_competicoes_personalizadas(auth_client, monkeypatch):
    patch_network(monkeypatch)
    # padrão do Cruzeiro já traz 4 competições; escolher o mesmo time mantém
    auth_client.post("/api/config/team", json={"provider": "thesportsdb", "id": "134294"})
    config = auth_client.get("/api/config").json()
    assert [c["id"] for c in config["team"]["competitions"]] == ["4351", "4725", "4501", "5763"]


def test_time_inexistente_responde_404(auth_client, monkeypatch):
    patch_network(monkeypatch)
    response = auth_client.post("/api/config/team", json={"provider": "thesportsdb", "id": "4040"})
    assert response.status_code == 404
    assert "não encontrado" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# Conta: usuário/senha
# --------------------------------------------------------------------------- #
def test_renomear_conta(auth_client):
    response = auth_client.put(
        "/api/auth/profile",
        json={"current_password": "segredo123", "username": "renomeado"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "renomeado"
    assert auth_client.get("/api/auth/me").json()["user"]["username"] == "renomeado"


def test_renomear_para_usuario_existente_da_conflito(auth_client, db):
    from app.services.auth import register_user

    register_user(db, "ocupado", "senha123")
    response = auth_client.put(
        "/api/auth/profile",
        json={"current_password": "segredo123", "username": "ocupado"},
    )
    assert response.status_code == 409


def test_perfil_senha_errada_e_validacoes(auth_client):
    wrong = auth_client.put(
        "/api/auth/profile", json={"current_password": "errada", "new_password": "nova1234"}
    )
    assert wrong.status_code == 401

    nothing = auth_client.put("/api/auth/profile", json={"current_password": "segredo123"})
    assert nothing.status_code == 400

    short = auth_client.put(
        "/api/auth/profile", json={"current_password": "segredo123", "new_password": "curta"}
    )
    assert short.status_code == 422


def test_trocar_senha_derruba_outras_sessoes(auth_client, db):
    from app.models import User
    from app.services.auth import create_session, user_for_token

    # uma segunda sessão criada direto no banco (outro dispositivo)
    owner = db.query(User).filter(User.username == "tester").first()
    other_token = create_session(db, owner)

    response = auth_client.put(
        "/api/auth/profile", json={"current_password": "segredo123", "new_password": "nova1234"}
    )
    assert response.status_code == 200

    # a outra sessão morreu; a atual continua viva
    assert user_for_token(db, other_token) is None
    assert auth_client.get("/api/auth/me").json()["authenticated"] is True

    # a senha nova passa a valer
    assert auth_client.post(
        "/api/auth/login", json={"username": "tester", "password": "nova1234"}
    ).status_code == 200


# --------------------------------------------------------------------------- #
# Reset via arquivo (senha temporária na raiz do volume)
# --------------------------------------------------------------------------- #
def test_reset_via_arquivo_grava_senha_temporaria(auth_client, db, tmp_path, monkeypatch):
    from app.config import get_settings
    from app.models import User
    from app.services.auth import create_session, user_for_token

    reset_dir = tmp_path / "resets"
    monkeypatch.setitem(get_settings(), "reset_dir", str(reset_dir))

    owner = db.query(User).filter(User.username == "tester").first()
    other_token = create_session(db, owner)

    response = auth_client.post("/api/auth/reset-file")
    assert response.status_code == 200
    body = response.json()

    # arquivo na raiz configurada, com usuário/senha legíveis
    path = reset_dir / "RESET-tester.txt"
    assert body["file"] == "RESET-tester.txt"
    assert body["path"] == str(path)
    content = path.read_text(encoding="utf-8")
    assert "Usuário: tester" in content
    assert body["password"] in content

    # a sessão atual continua; as outras morrem
    assert auth_client.get("/api/auth/me").json()["authenticated"] is True
    assert user_for_token(db, other_token) is None

    # a senha temporária entra; a antiga não
    assert auth_client.post(
        "/api/auth/login", json={"username": "tester", "password": body["password"]}
    ).status_code == 200
    assert auth_client.post(
        "/api/auth/login", json={"username": "tester", "password": "segredo123"}
    ).status_code == 401
