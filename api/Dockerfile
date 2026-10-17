# API OndeJoga (FastAPI) — usada pelo docker compose.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# `git` é o que faz a API responder qual commit está de pé: o docker-compose
# monta a raiz do projeto em `/ondejoga` (com o `.git`), e a aplicação lê
# dali — mesmo esquema do `pihole -v`. Sem ele a versão cairia para o número
# de release e ninguém saberia o que está rodando.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Dados de backup (fallback offline) já vão em `app/data`.
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
