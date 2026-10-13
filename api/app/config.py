"""Configuração por variáveis de ambiente."""

import os

# Planilha de preços
DEFAULT_SHEET_ID = os.getenv("SHEET_ID", "1vM1Oobfzbz0MnTKku1Vo6Nxpf9sOkYWBN9tiUqzjMbk")
DEFAULT_GID = os.getenv("SHEET_GID", "0")
CACHE_SECONDS = int(os.getenv("CACHE_SECONDS", "300"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "https://routemap-21.web.app,https://routemap-21.firebaseapp.com,http://localhost:5000,http://localhost:5500,http://127.0.0.1:5500,"
    "http://localhost:3000,http://127.0.0.1:3000,https://localhost:3000,https://127.0.0.1:3000",
).split(",") if o.strip()]
