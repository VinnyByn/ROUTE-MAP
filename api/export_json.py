"""Gera materiais.json a partir da planilha, usando o mesmo leitor da API.

Roda no deploy (GitHub Actions) para publicar os preços junto com o site, sem
precisar de um servidor Python. Uso: python api/export_json.py caminho/materiais.json
"""

import asyncio
import csv
import io
import json
import sys
from datetime import datetime, timezone

import main


async def build() -> dict:
    text = await main.fetch_sheet_csv(main.DEFAULT_SHEET_ID, main.DEFAULT_GID)
    skipped: list[str] = []
    items = main.parse_rows(list(csv.reader(io.StringIO(text))), skipped)
    for name in skipped:
        print(f"::warning::Material sem preço na planilha (não entra no catálogo): {name}")
    return {
        "fonte": f"https://docs.google.com/spreadsheets/d/{main.DEFAULT_SHEET_ID}",
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "total": len(items),
        "itens": [item.model_dump() for item in items],
    }


async def build_kits() -> dict:
    import kits
    text = await main.fetch_sheet_csv(kits.KITS_SHEET_ID, kits.KITS_SHEET_GID)
    return {
        "fonte": f"https://docs.google.com/spreadsheets/d/{kits.KITS_SHEET_ID}",
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "kits": kits.parse_kits(text),
    }


def write(target: str, builder, label: str, count) -> None:
    try:
        data = asyncio.run(builder())
    except Exception as error:  # Não derruba o deploy do site por causa da planilha
        detail = getattr(error, "detail", None) or str(error)
        print(f"::warning::Planilha de {label} não lida: {detail}")
        return
    with open(target, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=1)
    print(f"{count(data)} {label} gravados em {target}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "materiais.json"
    write(target, build, "materiais", lambda d: d["total"])
    kits_target = sys.argv[2] if len(sys.argv) > 2 else "kits.json"
    write(kits_target, build_kits, "kits", lambda d: {k: len(v) for k, v in d["kits"].items()})
