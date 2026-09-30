"""API de materiais do Route Map.

Lê a planilha de preços no Google Sheets e devolve os itens em JSON
(código, descrição, unidade e valor unitário). O sistema usa esse JSON para
atualizar a base de valores sem precisar importar a planilha à mão.

A planilha precisa estar compartilhada como "Qualquer pessoa com o link: Leitor".
"""

import csv
import io
import os
import re
import time
import unicodedata
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DEFAULT_SHEET_ID = os.getenv("SHEET_ID", "1vM1Oobfzbz0MnTKku1Vo6Nxpf9sOkYWBN9tiUqzjMbk")
DEFAULT_GID = os.getenv("SHEET_GID", "0")
CACHE_SECONDS = int(os.getenv("CACHE_SECONDS", "300"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "https://routemap-21.web.app,https://routemap-21.firebaseapp.com,http://localhost:5000",
).split(",") if o.strip()]

app = FastAPI(title="Route Map - Materiais", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


class Material(BaseModel):
    codigo: str
    descricao: str
    unidade: str
    valor_unitario: float


class MateriaisResponse(BaseModel):
    fonte: str
    atualizado_em: str
    total: int
    itens: list[Material]


# Nomes aceitos no cabeçalho de cada coluna (sem acento, minúsculo)
HEADER_ALIASES = {
    "codigo": ("codigo", "cod", "cod.", "codigo do item", "item", "sku", "referencia", "ref"),
    "descricao": ("descricao", "descricao do item", "material", "produto", "nome"),
    "unidade": ("unidade", "und", "un", "unid", "unid.", "medida"),
    "valor_unitario": ("valor unitario", "vlr unitario", "preco unitario", "valor unit", "valor", "preco", "custo unitario"),
}

_cache: dict[str, tuple[float, MateriaisResponse]] = {}


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def parse_price(value: str) -> float | None:
    """Converte "R$ 1.234,56", "1234.56" ou "12,5" em número."""
    text = str(value or "").strip()
    if not text or not re.search(r"\d", text):
        return None
    text = re.sub(r"[^0-9,.\-]", "", text)
    if "," in text and "." in text:
        # O separador que aparece por último é o decimal
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return round(float(text), 4)
    except ValueError:
        return None


def normalize_unit(value: str) -> str:
    unit = _normalize(value)
    if not unit:
        return "un"
    if unit in ("m", "mt", "mts", "metro", "metros") or unit.startswith("metro"):
        return "m"
    if unit in ("un", "und", "unid", "unidade", "pc", "pca", "pcs", "peca", "pecas"):
        return "un"
    return unit


def _find_header(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    """Procura, nas primeiras linhas, o cabeçalho com descrição e valor."""
    for index, row in enumerate(rows[:30]):
        cells = [_normalize(c) for c in row]
        columns: dict[str, int] = {}
        for field, aliases in HEADER_ALIASES.items():
            for col, cell in enumerate(cells):
                if col in columns.values():
                    continue
                if cell in aliases or any(cell.startswith(a) for a in aliases if len(a) > 3):
                    columns[field] = col
                    break
        if "descricao" in columns and "valor_unitario" in columns:
            return index, columns
    return None


def parse_rows(rows: list[list[str]]) -> list[Material]:
    header = _find_header(rows)
    if not header:
        raise HTTPException(
            status_code=422,
            detail="Não encontrei o cabeçalho na planilha. Use colunas como Código, Descrição, Unidade e Valor unitário.",
        )
    start, cols = header
    get = lambda row, field: row[cols[field]].strip() if field in cols and cols[field] < len(row) else ""
    items: list[Material] = []
    for row in rows[start + 1:]:
        descricao = get(row, "descricao")
        valor = parse_price(get(row, "valor_unitario"))
        if not descricao or valor is None:
            continue  # Linha vazia, título de seção ou total
        if _normalize(descricao) in ("total", "subtotal"):
            continue
        items.append(Material(
            codigo=get(row, "codigo"),
            descricao=descricao,
            unidade=normalize_unit(get(row, "unidade")),
            valor_unitario=valor,
        ))
    return items


async def fetch_sheet_csv(sheet_id: str, gid: str) -> str:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
        response = await client.get(url)
    content_type = response.headers.get("content-type", "")
    if response.status_code != 200 or "text/html" in content_type:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível ler a planilha. Confira se ela está compartilhada como 'Qualquer pessoa com o link'.",
        )
    return response.content.decode("utf-8-sig")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/materiais", response_model=MateriaisResponse)
async def listar_materiais(
    sheet_id: str = Query(DEFAULT_SHEET_ID, pattern=r"^[A-Za-z0-9_-]{20,}$"),
    gid: str = Query(DEFAULT_GID, pattern=r"^\d+$"),
    atualizar: bool = Query(False, description="Ignora o cache e lê a planilha de novo"),
):
    key = f"{sheet_id}:{gid}"
    cached = _cache.get(key)
    if cached and not atualizar and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]
    text = await fetch_sheet_csv(sheet_id, gid)
    rows = list(csv.reader(io.StringIO(text)))
    items = parse_rows(rows)
    result = MateriaisResponse(
        fonte=f"https://docs.google.com/spreadsheets/d/{sheet_id}",
        atualizado_em=datetime.now(timezone.utc).isoformat(),
        total=len(items),
        itens=items,
    )
    _cache[key] = (time.time(), result)
    return result


@app.get("/kits")
async def listar_kits(atualizar: bool = Query(False, description="Ignora o cache e lê a planilha de novo")):
    """Kits POP, OLT e placa da planilha de kits: itens com quantidade, unidade, valor e código."""
    import kits
    cached = _cache.get("kits")
    if cached and not atualizar and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]
    text = await fetch_sheet_csv(kits.KITS_SHEET_ID, kits.KITS_SHEET_GID)
    result = {
        "fonte": f"https://docs.google.com/spreadsheets/d/{kits.KITS_SHEET_ID}",
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "kits": kits.parse_kits(text),
    }
    _cache["kits"] = (time.time(), result)
    return result
