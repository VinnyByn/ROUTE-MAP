from fastapi.testclient import TestClient

import main

CSV = """Tabela de preços,,,
Código,Descrição,Unidade,Valor unitário
CB-12,CABO FIBRA OPTICA AS80 12F,m,"R$ 1,85"
FER-01,ALÇA PREFORMADA,UN,"R$ 3,20"
,Seção ferragens,,
PT-9,PARAFUSO,pç,"1.234,50"
,Total,,"1.239,55"
"""


def test_materiais(monkeypatch):
    async def fake_fetch(sheet_id, gid):
        return CSV
    monkeypatch.setattr(main, "fetch_sheet_csv", fake_fetch)
    main._cache.clear()
    res = TestClient(main.app).get("/materiais")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 3
    assert data["itens"][0] == {"codigo": "CB-12", "descricao": "CABO FIBRA OPTICA AS80 12F", "unidade": "m", "valor_unitario": 1.85}
    assert data["itens"][1]["unidade"] == "un"
    assert data["itens"][2]["valor_unitario"] == 1234.5


def test_sem_cabecalho(monkeypatch):
    async def fake_fetch(sheet_id, gid):
        return "a,b\n1,2\n"
    monkeypatch.setattr(main, "fetch_sheet_csv", fake_fetch)
    main._cache.clear()
    assert TestClient(main.app).get("/materiais").status_code == 422
