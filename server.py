"""
Cloud Run backend — proxies Gemini calls via google-genai SDK with Vertex AI
(Workload Identity, no API key needed).
Also serves the compiled React frontend from ./dist.
"""

import base64
import os
from typing import Any, Optional

from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Vertex AI client (Workload Identity on Cloud Run, no API key) ────────────
PROJECT  = os.getenv("VERTEX_PROJECT",  "project-2aed790f-b594-45e5-a62")
LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)

# ── Model fallback chains (frontend name → ordered Vertex AI model list) ─────
MODEL_FALLBACKS: dict[str, list[str]] = {
    # Image generation
    "gemini-3.1-flash-image-preview": ["gemini-2.0-flash-exp", "gemini-2.0-flash-001", "gemini-1.5-flash-001"],
    "gemini-2.5-flash-image":         ["gemini-2.0-flash-exp", "gemini-2.0-flash-001", "gemini-1.5-flash-001"],
    # Text / audit / matching
    "gemini-3-flash-preview":         ["gemini-2.0-flash-001", "gemini-1.5-flash-001"],
    "gemini-3.0-flash-preview":       ["gemini-2.0-flash-001", "gemini-1.5-flash-001"],
    # Already-valid names — still provide fallback
    "gemini-2.0-flash-001":           ["gemini-2.0-flash-001", "gemini-1.5-flash-001"],
    "gemini-1.5-flash-8b":            ["gemini-1.5-flash-001"],
    "gemini-1.5-flash-8b-001":        ["gemini-1.5-flash-001"],
}

app = FastAPI()


# ── Request model ─────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    model: str
    contents: Any          # mirrors @google/genai JS SDK format
    config: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_contents(contents: Any) -> list:
    """Convert @google/genai JS SDK contents format to google-genai Part list."""
    if isinstance(contents, str):
        return [types.Part.from_text(text=contents)]

    raw: list[Any] = []
    if isinstance(contents, dict) and "parts" in contents:
        raw = contents["parts"]
    elif isinstance(contents, list):
        raw = contents
    else:
        return [types.Part.from_text(text=str(contents))]

    parts: list = []
    for p in raw:
        if isinstance(p, str):
            parts.append(types.Part.from_text(text=p))
        elif isinstance(p, dict):
            if "text" in p:
                parts.append(types.Part.from_text(text=p["text"]))
            elif "inlineData" in p:
                raw_bytes = base64.b64decode(p["inlineData"]["data"])
                parts.append(types.Part.from_bytes(
                    data=raw_bytes,
                    mime_type=p["inlineData"]["mimeType"]
                ))
    return parts


def build_config(config: dict | None) -> types.GenerateContentConfig | None:
    if not config:
        return None
    kwargs: dict = {}
    if "responseMimeType" in config:
        kwargs["response_mime_type"] = config["responseMimeType"]
    if "imageConfig" in config:
        kwargs["response_modalities"] = ["IMAGE", "TEXT"]
    return types.GenerateContentConfig(**kwargs) if kwargs else None


def serialize_response(response: Any) -> dict:
    """Convert google-genai response to @google/genai JS SDK compatible dict."""
    result: dict = {"candidates": [], "text": ""}

    try:
        result["text"] = response.text or ""
    except Exception:
        pass

    for candidate in response.candidates:
        cand: dict = {"content": {"parts": []}}
        for part in candidate.content.parts:
            if getattr(part, "text", None):
                cand["content"]["parts"].append({"text": part.text})
            elif getattr(part, "inline_data", None):
                cand["content"]["parts"].append({
                    "inlineData": {
                        "data": base64.b64encode(part.inline_data.data).decode(),
                        "mimeType": part.inline_data.mime_type,
                    }
                })
        result["candidates"].append(cand)

    return result


# ── API endpoint ──────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    model_candidates = MODEL_FALLBACKS.get(req.model, [req.model])
    contents = build_contents(req.contents)
    config = build_config(req.config)

    last_exc: Exception = RuntimeError("No models tried")
    for model_name in model_candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )
            return serialize_response(response)
        except Exception as exc:
            print(f"[fallback] {model_name} failed: {exc}")
            last_exc = exc

    raise HTTPException(status_code=500, detail=str(last_exc))


# ── Serve compiled React SPA ──────────────────────────────────────────────────
DIST = "dist"
if os.path.isdir(DIST) and os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=f"{DIST}/assets"), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    candidate = os.path.join(DIST, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    return FileResponse(os.path.join(DIST, "index.html"))
