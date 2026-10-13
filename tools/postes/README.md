# Postes da rede (BDGD/ANEEL)

Base de postes usada pela camada **Postes da rede** do mapa e pelo **pré-projeto automático**. É estática: são
arquivos publicados junto com o site em `web/postes/`, sem servidor nem API.

## Como se atualiza (sozinha)

O workflow `.github/workflows/postes.yml` roda todo dia 5. Ele confere no portal de dados abertos da ANEEL qual é a
BDGD mais nova das distribuidoras de Minas Gerais, Cemig-D e DME (Poços de Caldas; opcional); a ANEEL publica uma por ano. Só quando aparece versão nova ele baixa o arquivo (~4 GB),
gera os tiles e publica a release `postes-AAAA-MM-DD` no GitHub. Depois dispara o deploy, que coloca os tiles em
`web/postes/`. Se algo falhar, nada é publicado e o site continua com a base anterior.

Para rodar na mão: **Actions → Postes da BDGD → Run workflow** (marque "forçar" para gerar de novo a mesma versão).

## Formato

- `web/postes/manifest.json`: versão publicada (`versao`, `data_base`, `arquivo`, `total`).
- `web/postes/<versao>/<x>/<y>.bin`: tile Web Mercator de zoom 13 (~4,6 km de lado). São pares Uint16 little-endian
  com a posição de cada poste dentro do tile, em 65536 passos (~7 cm), ou seja, 4 bytes por poste. Um tile sem postes
  não tem arquivo (o site trata o 404 como vazio).
- Cemig-D 2025-12-31: 6,28 milhões de postes em 25,8 mil tiles, 24 MB no total. Metade dos tiles tem menos de 0,6 KB,
  e o maior (centro de BH) tem 70 KB.
- Na BDGD, poste é `PONNOT.TIP_PN = 'POS'`.

## Arquivos

- `bdgd-mais-nova.mjs`: acha a BDGD mais nova no portal da ANEEL.
- `gerar-tiles.mjs`: CSV (`X`,`Y`) → `manifest.json` + tiles. No workflow, o CSV sai do `ogr2ogr`, que roda numa
  imagem Docker do GDAL.
- `tiles.mjs`: contas do formato. O site faz a mesma conta em `web/js/map/poles-layer.js`.
- `testar.mjs`: testes que rodam no CI (`node tools/postes/testar.mjs`).

## Rodar local com postes

Baixe `postes.tar.gz` da release `postes-*` mais nova do repositório (página **Releases** do GitHub) e extraia dentro
de `web/`. Fica `web/postes/manifest.json`. A pasta está no `.gitignore`.
