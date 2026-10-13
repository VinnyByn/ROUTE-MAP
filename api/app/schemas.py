"""Formatos de resposta da API."""

from pydantic import BaseModel


class Material(BaseModel):
    codigo: str
    descricao: str
    unidade: str
    valor_unitario: float
    secao: str = ""


class MateriaisResponse(BaseModel):
    fonte: str
    atualizado_em: str
    total: int
    itens: list[Material]
