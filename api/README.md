# API de materiais (FastAPI)

Lê a planilha de preços da empresa no Google Sheets e devolve os itens em JSON.
O botão **Atualizar pela API**, no catálogo de materiais do Route Map, usa essa
resposta para atualizar os preços, no lugar de importar a planilha à mão.

## Planilha

- Compartilhe como **Qualquer pessoa com o link → Leitor** (a API lê o CSV público).
- Precisa ter um cabeçalho com **Descrição** e **Valor unitário**. **Código** e
  **Unidade** são opcionais. A ordem das colunas não importa, e linhas vazias,
  títulos de seção e "Total" são ignorados.

## Endpoints

- `GET /materiais`: lista os itens. Parâmetros opcionais: `sheet_id`, `gid` (aba)
  e `atualizar=true` (ignora o cache de 5 minutos).
- `GET /health`: checagem de funcionamento.

Resposta:

```json
{
  "fonte": "https://docs.google.com/spreadsheets/d/…",
  "atualizado_em": "2026-09-30T15:00:00+00:00",
  "total": 1,
  "itens": [
    { "codigo": "CB-12", "descricao": "CABO FIBRA OPTICA AS80 12F", "unidade": "m", "valor_unitario": 1.85 }
  ]
}
```

## Rodar localmente

```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# http://localhost:8000/materiais  ·  documentação em http://localhost:8000/docs
```

Testes: `pip install pytest && pytest -q`

## Como funciona sem servidor

O botão **Atualizar pela API** tenta, nesta ordem:

1. a FastAPI publicada, se houver uma URL configurada;
2. a planilha ao vivo, lida direto no navegador (mesmas regras de colunas da API);
3. o `materiais.json` gerado por `export_json.py` a cada deploy e a cada 6 horas
   (GitHub Actions), publicado junto com o site.

## Publicar a FastAPI (opcional)

A API precisa de um servidor Python (o Firebase Hosting só serve arquivos estáticos).
Com o `Dockerfile` desta pasta, funciona em Render, Railway, Fly.io ou Google Cloud Run.
No Render (plano gratuito): **New → Web Service**, escolha este repositório,
**Root Directory** `api`, ambiente **Docker**.

Variáveis de ambiente (opcionais):

| Variável | Padrão |
|---|---|
| `SHEET_ID` | planilha da empresa |
| `SHEET_GID` | `0` (primeira aba) |
| `CACHE_SECONDS` | `300` |
| `ALLOWED_ORIGINS` | `https://routemap-21.web.app,https://routemap-21.firebaseapp.com,http://localhost:5000` |

Depois de publicar, coloque a URL em `DEFAULT_MATERIALS_API_URL` (em `script.js`).
Outra opção é informar a URL ao clicar em **Atualizar pela API**. Segure Shift
ao clicar para trocar a URL.
