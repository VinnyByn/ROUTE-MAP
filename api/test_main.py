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
    assert data["itens"][0] == {"codigo": "CB-12", "descricao": "CABO FIBRA OPTICA AS80 12F", "unidade": "m", "valor_unitario": 1.85, "secao": ""}
    assert data["itens"][1]["unidade"] == "un"
    assert data["itens"][2]["valor_unitario"] == 1234.5


def test_sem_cabecalho(monkeypatch):
    async def fake_fetch(sheet_id, gid):
        return "a,b\n1,2\n"
    monkeypatch.setattr(main, "fetch_sheet_csv", fake_fetch)
    main._cache.clear()
    assert TestClient(main.app).get("/materiais").status_code == 422


def test_kits():
    import kits
    csv_text = """LEVANTAMENTO DE CUSTO PARA NOVO POP,,,,,
Especificações,Quantidade,Unidade,Valor,Total,Código Protheus
Equipamentos Passivos,,,,,
Rack Indoor 44U,1,unid,"R$ 4.736,38","R$ 4.736,38",994014
"XFP 850NM",0,unid,"R$ 249,00",R$ -,993998
SWITCH MPLS 24 PORTAS,1,unid,"R$ 24.538,31","R$ 24.538,31",-
LEVANTAMENTO DE CUSTO PARA OLT,,,,,
Especificações,Quantidade,Unidade,Valor,Total,Código Protheus
Chassi OLT C650 ZTE,1,unid,"R$ 2.782,23","R$ 2.782,23",991315
LEVANTAMENTO DE CUSTO PARA NOVA PLACA,,,,,
Cordão Óptico,16,unid,"R$ 6,90","R$ 110,40",994035
"""
    data = kits.parse_kits(csv_text)
    assert list(data) == ["KIT POP", "KIT OLT", "KIT PLACA"]
    assert data["KIT POP"][0] == {"codigo": "994014", "descricao": "Rack Indoor 44U", "quantidade": 1.0, "unidade": "un", "valor_unitario": 4736.38}
    assert len(data["KIT POP"]) == 2 and data["KIT POP"][1]["codigo"] == ""
    assert data["KIT PLACA"][0]["quantidade"] == 16


def test_secoes(monkeypatch):
    async def fake_fetch(sheet_id, gid):
        return "Código,Descrição,Unidade,Valor unitário\nFERRAGENS,,,\n1,ALÇA,un,\"1,00\"\nDATA CENTER,,,\n2,SWITCH,un,\"10,00\"\n"
    monkeypatch.setattr(main, "fetch_sheet_csv", fake_fetch)
    main._cache.clear()
    itens = TestClient(main.app).get("/materiais").json()["itens"]
    assert [i["secao"] for i in itens] == ["FERRAGENS", "DATA CENTER"]
