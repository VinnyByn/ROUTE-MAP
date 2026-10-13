"""GET /materiais e GET /kits: dados das planilhas de preços e de kits."""

import csv
import io
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app import config
from app.schemas import MateriaisResponse
from app.services import kits, planilhas

router = APIRouter()

_cache: dict[str, tuple[float, object]] = {}


@router.get("/materiais", response_model=MateriaisResponse)
async def listar_materiais(
    sheet_id: str = Query(config.DEFAULT_SHEET_ID, pattern=r"^[A-Za-z0-9_-]{20,}$"),
    gid: str = Query(config.DEFAULT_GID, pattern=r"^\d+$"),
    atualizar: bool = Query(False, description="Ignora o cache e lê a planilha de novo"),
):
    key = f"{sheet_id}:{gid}"
    cached = _cache.get(key)
    if cached and not atualizar and time.time() - cached[0] < config.CACHE_SECONDS:
        return cached[1]
    text = await planilhas.fetch_sheet_csv(sheet_id, gid)
    rows = list(csv.reader(io.StringIO(text)))
    items = planilhas.parse_rows(rows)
    result = MateriaisResponse(
        fonte=f"https://docs.google.com/spreadsheets/d/{sheet_id}",
        atualizado_em=datetime.now(timezone.utc).isoformat(),
        total=len(items),
        itens=items,
    )
    _cache[key] = (time.time(), result)
    return result


@router.get("/kits")
async def listar_kits(atualizar: bool = Query(False, description="Ignora o cache e lê a planilha de novo")):
    """Kits POP, OLT e placa da planilha de kits: itens com quantidade, unidade, valor e código."""
    cached = _cache.get("kits")
    if cached and not atualizar and time.time() - cached[0] < config.CACHE_SECONDS:
        return cached[1]
    text = await planilhas.fetch_sheet_csv(kits.KITS_SHEET_ID, kits.KITS_SHEET_GID)
    result = {
        "fonte": f"https://docs.google.com/spreadsheets/d/{kits.KITS_SHEET_ID}",
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "kits": kits.parse_kits(text),
    }
    _cache["kits"] = (time.time(), result)
    return result
