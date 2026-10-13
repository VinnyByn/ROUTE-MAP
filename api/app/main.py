"""API do Route Map: preços de materiais e kits (planilhas).

Rodar: uvicorn app.main:app --reload --port 8000   (de dentro da pasta api/)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import config
from app.routers import materiais

app = FastAPI(title="Route Map - Materiais", version="2.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(materiais.router)


@app.get("/health")
def health():
    return {"status": "ok"}
