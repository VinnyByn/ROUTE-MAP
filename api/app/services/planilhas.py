"""Leitura da planilha de preços (Google Sheets, CSV público) e conversão em materiais."""

import re
import unicodedata

import httpx
from fastapi import HTTPException

from app.schemas import Material

# Nomes aceitos no cabeçalho de cada coluna (sem acento, minúsculo)
HEADER_ALIASES = {
    "codigo": ("codigo", "cod", "cod.", "codigo do item", "item", "sku", "referencia", "ref"),
    "descricao": ("descricao", "descricao do item", "material", "produto", "nome"),
    "unidade": ("unidade", "und", "un", "unid", "unid.", "medida"),
    "valor_unitario": ("valor unitario", "vlr unitario", "preco unitario", "valor unit", "valor", "preco", "custo unitario"),
}

def normalize_text(text: str) -> str:
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
    unit = normalize_text(value)
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
        cells = [normalize_text(c) for c in row]
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


def parse_rows(rows: list[list[str]], skipped: list[str] | None = None) -> list[Material]:
    """Lê os materiais. Linhas com descrição mas sem preço vão para "skipped" (quando informado)."""
    header = _find_header(rows)
    if not header:
        raise HTTPException(
            status_code=422,
            detail="Não encontrei o cabeçalho na planilha. Use colunas como Código, Descrição, Unidade e Valor unitário.",
        )
    start, cols = header
    get = lambda row, field: row[cols[field]].strip() if field in cols and cols[field] < len(row) else ""
    items: list[Material] = []
    section = ""
    for row in rows[start + 1:]:
        descricao = get(row, "descricao")
        valor = parse_price(get(row, "valor_unitario"))
        if valor is None:
            # Material sem preço (tem descrição e unidade): fica de fora e não muda a seção
            if descricao and get(row, "unidade"):
                if skipped is not None and normalize_text(descricao) not in ("total", "subtotal"):
                    skipped.append(descricao)
                continue
            # Título de seção: primeira célula com texto numa linha sem preço (ex.: "DATA CENTER")
            title = next((c.strip() for c in row if c.strip() and not re.search(r"\d{3,}", c)), "")
            header_words = {alias for aliases in HEADER_ALIASES.values() for alias in aliases}
            if title and normalize_text(title) not in ("total", "subtotal") and normalize_text(title) not in header_words:
                section = title
            continue
        if not descricao:
            continue
        if normalize_text(descricao) in ("total", "subtotal"):
            continue
        items.append(Material(
            codigo=get(row, "codigo"),
            descricao=descricao,
            unidade=normalize_unit(get(row, "unidade")),
            valor_unitario=valor,
            secao=section,
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
