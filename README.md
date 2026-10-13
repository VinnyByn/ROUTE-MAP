# Route Map

Projeto de redes ópticas (FTTH) no mapa: marcadores, cabos, fusões, orçamento, relatório e pré-projeto automático.

## Estrutura

```
web/        site publicado no Firebase Hosting (index.html, login.html, css/, js/, img/)
api/        FastAPI: preços de materiais (planilhas)
tools/      gerador da base de postes da BDGD/ANEEL (JavaScript, roda sozinho no GitHub)
supabase/   migrações e testes do banco
tests/      teste de fumaça do site (Playwright)
docs/       documentação técnica e manual do usuário
```

Detalhes de cada pasta em [docs/documentacao-tecnica.txt](docs/documentacao-tecnica.txt) e [api/README.md](api/README.md).

## Rodar

- **Site:** sirva a pasta `web/` com qualquer servidor estático (ex.: `npx serve web`).
- **API:** `cd api && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
- **Testes:** `node tools/postes/testar.mjs`, `cd api && python -m pytest -q` e `cd tests && npm install && node smoke.mjs`
