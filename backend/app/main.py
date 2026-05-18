"""MIND BREEZE 2.0 — FastAPI Application Entry Point"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="MIND BREEZE 2.0",
    description="뇌파 기반 심리상담·명상 통합 서비스 플랫폼 API",
    version="0.1.0",
)

# CORS (개발 환경 — 전체 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "mindbreeze-api"}


@app.get("/api/v1/")
async def root():
    return {"version": "0.1.0", "docs": "/docs"}
