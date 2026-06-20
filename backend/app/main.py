import os
from datetime import datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

app = FastAPI(title="MCD Deep Learning API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("API_KEY", "changeme")
api_key_header = APIKeyHeader(name="X-API-Key")


def verify_api_key(key: str = Security(api_key_header)):
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


class PredictionInput(BaseModel):
    instances: list[dict]
    parameters: dict | None = None


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/v1/models")
def list_models():
    return {
        "data": [
            {"id": "deeplearning-v1", "object": "model", "ready": True}
        ],
        "object": "list",
    }


@app.post("/v1/predictions", dependencies=[Depends(verify_api_key)])
def predict(body: PredictionInput):
    predictions = [
        {"class": "sample_class", "confidence": 0.95}
        for _ in body.instances
    ]
    return {
        "id": "pred-001",
        "object": "prediction",
        "created": int(datetime.now(timezone.utc).timestamp()),
        "model": "deeplearning-v1",
        "data": predictions,
        "meta": {
            "instances_count": len(body.instances),
            "parameters": body.parameters,
        },
    }
