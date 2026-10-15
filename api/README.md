# API de materiais (FastAPI)

Lê a planilha de preços da empresa no Google Sheets e devolve os itens em JSON.
O botão **Atualizar da planilha**, no catálogo de materiais do Route Map, usa essa
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
uvicorn app.main:app --reload --port 8000
# http://localhost:8000/materiais  ·  documentação em http://localhost:8000/docs
```

Testes: `pip install pytest && python -m pytest -q`

## Como funciona sem servidor

Cada empresa informa as próprias planilhas (preços e, se quiser, kits) no catálogo, em
**Regras de cálculo › Planilhas da empresa**. Elas ficam salvas no catálogo da empresa
(`company_settings.material_catalog.sources`). Empresa nova começa sem preços e sem planilhas.

O botão **Atualizar da planilha** lê a planilha de preços da empresa, nesta ordem:

1. a FastAPI publicada, se houver uma URL configurada (com `sheet_id` e `gid` da empresa);
2. a planilha ao vivo, lida direto no navegador (mesmas regras de colunas da API);
3. o `materiais.json` gerado por `scripts/export_json.py` a cada deploy e a cada 6 horas
   (GitHub Actions), só se ele for da mesma planilha da empresa.

Os arquivos `materiais.json` e `kits.json` do deploy são das planilhas `SHEET_ID` e
`KITS_SHEET_ID`: só as empresas que usam essas mesmas planilhas os aproveitam.

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
| `ALLOWED_ORIGINS` | `https://routemap-21.web.app,https://routemap-21.firebaseapp.com,...e localhost/127.0.0.1 nas portas 3000, 5000 e 5500` |

Depois de publicar, coloque a URL em `DEFAULT_MATERIALS_API_URL` (em `web/js/catalog/catalog.js`).
Outra opção é informar a URL ao clicar em **Atualizar da planilha**. Segure Shift
ao clicar para trocar a URL.

## Estrutura

```
app/        main.py (FastAPI), config.py (variáveis de ambiente), schemas.py
  routers/    materiais.py (/materiais, /kits)
  services/   planilhas.py, kits.py (leitura das planilhas)
scripts/    export_json.py (gera materiais.json e kits.json no deploy)
tests/      pytest
```

Os postes da rede (BDGD/ANEEL) não passam por esta API: veja `tools/postes/README.md`.
