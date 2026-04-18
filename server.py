"""
Cloud Run backend — proxies Gemini calls via Vertex AI SDK (Workload Identity, no API key).
Also serves the compiled React frontend from ./dist.
"""

import base64
import os
from typing import Any, Optional

import vertexai
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from vertexai.generative_models import GenerationConfig, GenerativeModel, Part

# ── Vertex AI init (uses Workload Identity on Cloud Run automatically) ───────
PROJECT  = os.getenv("VERTEX_PROJECT",  "project-2aed790f-b594-45e5-a62")
LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")   # us-central1 has broadest model support
vertexai.init(project=PROJECT, location=LOCATION)

# ── Model fallback chains (AI Studio name → ordered list of Vertex AI models) ─
# The backend tries each model in order until one succeeds.
MODEL_FALLBACKS: dict[str, list[str]] = {
    # Image generation
    "gemini-3.1-flash-image-preview": ["gemini-2.0-flash-exp", "gemini-2.0-flash-001"],
    "gemini-2.5-flash-image":         ["gemini-2.0-flash-exp", "gemini-2.0-flash-001"],
    # Text / audit / matching
    "gemini-3-flash-preview":         ["gemini-2.5-flash-preview-04-17", "gemini-2.0-flash-001"],
    "gemini-3.0-flash-preview":       ["gemini-2.5-flash-preview-04-17", "gemini-2.0-flash-001"],
    # Already-valid Vertex AI names — still provide a fallback
    "gemini-2.0-flash-001":           ["gemini-2.0-flash-001"],
    "gemini-1.5-flash-8b":            ["gemini-2.0-flash-001"],
    "gemini-1.5-flash-8b-001":        ["gemini-2.0-flash-001"],
}

app = FastAPI()


# ── Request / response models ────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    model: str
    contents: Any          # mirrors @google/genai contents format
    config: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def build_parts(contents: Any) -> list[Part]:
    """Convert @google/genai SDK contents to a Vertex AI Part list."""
    if isinstance(contents, str):
        return [Part.from_text(contents)]

    raw: list[Any] = []
    if isinstance(contents, dict) and "parts" in contents:
        raw = contents["parts"]
    elif isinstance(contents, list):
        raw = contents
    else:
        return [Part.from_text(str(contents))]

    parts: list[Part] = []
    for p in raw:
        if isinstance(p, str):
            parts.append(Part.from_text(p))
        elif isinstance(p, dict):
            if "text" in p:
                parts.append(Part.from_text(p["text"]))
            elif "inlineData" in p:
                raw_bytes = base64.b64decode(p["inlineData"]["data"])
                parts.append(Part.from_data(raw_bytes, p["inlineData"]["mimeType"]))
    return parts


def build_generation_config(config: dict | None) -> GenerationConfig | None:
    if not config:
        return None
    kwargs: dict = {}
    if "responseMimeType" in config:
        kwargs["response_mime_type"] = config["responseMimeType"]
    if "imageConfig" in config:
        # Ask the model to emit image bytes alongside text
        kwargs["response_modalities"] = ["IMAGE", "TEXT"]
    return GenerationConfig(**kwargs) if kwargs else None


def serialize_response(response: Any) -> dict:
    """Convert a Vertex AI GenerationResponse to @google/genai-compatible dict."""
    result: dict = {"candidates": [], "text": ""}

    # Top-level .text shortcut (text-only responses)
    try:
        result["text"] = response.text or ""
    except Exception:
        pass

    for candidate in response.candidates:
        cand: dict = {"content": {"parts": []}}
        for part in candidate.content.parts:
            # Text part
            if getattr(part, "text", None):
                cand["content"]["parts"].append({"text": part.text})
                continue
            # Inline-data part (image bytes inside the proto)
            try:
                raw = part._raw_part  # internal proto Part
                if raw.HasField("inline_data"):
                    cand["content"]["parts"].append({
                        "inlineData": {
                            "data": base64.b64encode(raw.inline_data.data).decode(),
                            "mimeType": raw.inline_data.mime_type,
                        }
                    })
            except Exception:
                pass
        result["candidates"].append(cand)

    return result


# ── API endpoint ─────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    candidates = MODEL_FALLBACKS.get(req.model, [req.model])
    parts = build_parts(req.contents)
    gen_config = build_generation_config(req.config)

    last_exc: Exception = RuntimeError("No models tried")
    for model_name in candidates:
        try:
            response = GenerativeModel(model_name).generate_content(
                parts, generation_config=gen_config
            )
            return serialize_response(response)
        except Exception as exc:
            print(f"[fallback] {model_name} failed: {exc}")
            last_exc = exc

    raise HTTPException(status_code=500, detail=str(last_exc))


# ── Serve compiled React SPA ─────────────────────────────────────────────────
DIST = "dist"
if os.path.isdir(DIST) and os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=f"{DIST}/assets"), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    candidate = os.path.join(DIST, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    return FileResponse(os.path.join(DIST, "index.html"))
