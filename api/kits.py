"""Leitor da planilha de kits (POP, OLT e placa).

A planilha tem blocos "LEVANTAMENTO DE CUSTO PARA ...", cada um com o cabeçalho
Especificações, Quantidade, Unidade, Valor, Total e Código Protheus, e linhas de
seção (ex.: "Equipamentos Passivos") sem quantidade.
"""

import csv
import io

from main import _normalize, normalize_unit, parse_price

KITS_SHEET_ID = "1MVwYAzcUOhZxB7DxqHzghBKwYmU7ShSuYqF3xF-tlnE"
KITS_SHEET_GID = "0"

# Título do bloco na planilha → nome do kit no sistema
KIT_TITLES = {
    "novo pop": "KIT POP",
    "pop": "KIT POP",
    "olt": "KIT OLT",
    "nova placa": "KIT PLACA",
    "placa": "KIT PLACA",
}


def _kit_name(title: str) -> str | None:
    text = _normalize(title)
    prefix = "levantamento de custo para "
    if not text.startswith(prefix):
        return None
    return KIT_TITLES.get(text[len(prefix):].strip())


def parse_kits(text: str) -> dict:
    rows = list(csv.reader(io.StringIO(text)))
    kits: dict[str, list[dict]] = {}
    current = None
    for row in rows:
        cells = [c.strip() for c in row] + [""] * 6
        name = _kit_name(cells[0])
        if name:
            current = name
            kits.setdefault(current, [])
            continue
        if not current or not cells[0] or _normalize(cells[0]).startswith("especifica"):
            continue
        quantity = parse_price(cells[1])
        price = parse_price(cells[3])
        if quantity is None or quantity <= 0 or price is None:
            continue  # Seção, título ou item com quantidade zero
        code = cells[5] if cells[5] not in ("-", "?") else ""
        kits[current].append({
            "codigo": code,
            "descricao": cells[0],
            "quantidade": quantity,
            "unidade": normalize_unit(cells[2]),
            "valor_unitario": price,
        })
    return {name: items for name, items in kits.items() if items}
