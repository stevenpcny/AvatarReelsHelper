"""
Cloud Run backend — proxies Gemini calls via google-genai SDK with Vertex AI
(Workload Identity, no API key needed).
Also serves the compiled React frontend from ./dist.
"""

import base64
import hmac
import json
import os
import re
import time
import uuid
from typing import Any, Optional

from datetime import timedelta

from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Vertex AI client (Workload Identity on Cloud Run, no API key) ────────────
PROJECT  = os.getenv("VERTEX_PROJECT",  "project-2aed790f-b594-45e5-a62")
LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)

# ── Session store (GCS-backed, stateless-friendly for Cloud Run) ─────────────
# A session holds the server-side audited copy so Hermes can fetch the exact
# same corrected text it must match images against.
SESSION_BUCKET = os.getenv("SESSION_BUCKET", "")
_gcs = None
if SESSION_BUCKET:
    from google.cloud import storage  # lazy: only when configured
    _gcs = storage.Client(project=PROJECT)


def _session_blob(session_id: str):
    # Guard against path traversal via crafted ids.
    if not re.fullmatch(r"[A-Za-z0-9_-]+", session_id):
        raise HTTPException(status_code=400, detail="非法 session id")
    return _gcs.bucket(SESSION_BUCKET).blob(f"sessions/{session_id}.json")


def save_session(session_id: str, data: dict) -> None:
    if not _gcs:
        raise HTTPException(status_code=503, detail="SESSION_BUCKET 未配置")
    _session_blob(session_id).upload_from_string(
        json.dumps(data, ensure_ascii=False), content_type="application/json"
    )


def load_session(session_id: str) -> Optional[dict]:
    if not _gcs:
        raise HTTPException(status_code=503, detail="SESSION_BUCKET 未配置")
    blob = _session_blob(session_id)
    if not blob.exists():
        return None
    return json.loads(blob.download_as_text())


# ── Image storage in GCS (uploaded from the user's machine for remote Hermes) ─

def _valid_id(session_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", session_id):
        raise HTTPException(status_code=400, detail="非法 session id")
    return session_id


def _safe_name(name: str) -> str:
    # Keep unicode (Chinese) filenames but block path traversal / separators.
    base = os.path.basename(name).replace("\\", "")
    if not base or base in (".", ".."):
        raise HTTPException(status_code=400, detail="非法文件名")
    return base


def _image_blob(session_id: str, name: str):
    return _gcs.bucket(SESSION_BUCKET).blob(
        f"sessions/{_valid_id(session_id)}/images/{_safe_name(name)}"
    )


def _signer():
    """Credentials capable of v4 signing via IAM signBlob (no key file needed
    on Cloud Run). Requires roles/iam.serviceAccountTokenCreator on the SA."""
    import google.auth
    from google.auth.transport import requests as ga_requests
    creds, _ = google.auth.default()
    creds.refresh(ga_requests.Request())
    email = getattr(creds, "service_account_email", None)
    if not email or email == "default":
        import urllib.request
        req = urllib.request.Request(
            "http://metadata.google.internal/computeMetadata/v1/instance/"
            "service-accounts/default/email",
            headers={"Metadata-Flavor": "Google"},
        )
        email = urllib.request.urlopen(req, timeout=5).read().decode()
    return creds, email


def signed_put_url(session_id: str, name: str, content_type: str) -> str:
    creds, email = _signer()
    return _image_blob(session_id, name).generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=30),
        method="PUT",
        content_type=content_type,
        service_account_email=email,
        access_token=creds.token,
    )


def list_session_images(session_id: str) -> list[dict]:
    prefix = f"sessions/{_valid_id(session_id)}/images/"
    out = []
    for b in _gcs.bucket(SESSION_BUCKET).list_blobs(prefix=prefix):
        name = b.name[len(prefix):]
        if not name:
            continue
        out.append({
            "name": name,
            "gsUri": f"gs://{SESSION_BUCKET}/{b.name}",
            "mime": b.content_type or "image/jpeg",
        })
    return out

# ── Model fallback chains (frontend name → ordered Vertex AI model list) ─────
MODEL_FALLBACKS: dict[str, list[str]] = {
    # Image generation
    "gemini-3.1-flash-image-preview": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash-image":         ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    # Text / audit / matching
    "gemini-3-flash-preview":         ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-3.0-flash-preview":       ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    # Already-valid names — still provide fallback
    "gemini-2.0-flash-001":           ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-1.5-flash-8b":            ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-1.5-flash-8b-001":        ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
}

# ── Access protection ─────────────────────────────────────────────────────────
ACCESS_CODE = os.getenv("ACCESS_CODE", "")   # set this env var in Cloud Run

def _make_token(code: str) -> str:
    # Day-scoped HMAC: token rotates every UTC day, stateless across Cloud Run instances.
    day = str(int(time.time()) // 86400).encode()
    return hmac.new(code.encode(), day, "sha256").hexdigest()

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
            elif "fileData" in p:
                # gs:// URI — Vertex reads directly from GCS (used by remote Hermes).
                parts.append(types.Part.from_uri(
                    file_uri=p["fileData"]["fileUri"],
                    mime_type=p["fileData"]["mimeType"],
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


# ── Auth endpoints ────────────────────────────────────────────────────────────

class AuthRequest(BaseModel):
    code: str

@app.post("/api/auth/login")
async def login(req: AuthRequest):
    if ACCESS_CODE and not hmac.compare_digest(req.code, ACCESS_CODE):
        raise HTTPException(status_code=401, detail="访问码错误")
    return {"token": _make_token(ACCESS_CODE)}

@app.get("/api/auth/check")
async def check(x_access_token: str = Header(default="")):
    if ACCESS_CODE and not hmac.compare_digest(x_access_token, _make_token(ACCESS_CODE)):
        raise HTTPException(status_code=401, detail="未授权")
    return {"ok": True}


# ── API endpoint ──────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(req: GenerateRequest, x_access_token: str = Header(default="")):
    if ACCESS_CODE and not hmac.compare_digest(x_access_token, _make_token(ACCESS_CODE)):
        raise HTTPException(status_code=401, detail="未授权，请刷新页面重新登录")
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


# ── Copy audit (校验) — ported from the former front-end logic ────────────────
# Produces the canonical "corrected copy" stored in a session, which Hermes
# later fetches to match images against.

_CHINESE_CHAR = r"一-龥　-〿＀-￯"
_TSV_ROW_START = re.compile(r"^(\d+)\t", re.MULTILINE)
_SEG_RE = re.compile(
    r'(^|[\n\s.!?"\'“”])(\d{1,3}[\.\s\t]+)'
    r'(?=["\'“‘\s]*[' + _CHINESE_CHAR + r'])'
)
_ID_PREFIX = re.compile(r"^(\d+[\.\s\t]+)")
_TRAILING_PUNCT = re.compile(r"^[\s“”\"‘’'\)\]}>]+")
_CHINESE_TEST = re.compile(r"[" + _CHINESE_CHAR + r"]")


def _has_chinese(s: str) -> bool:
    return bool(_CHINESE_TEST.search(s or ""))


def _strip_quotes(s: str) -> str:
    return re.sub(r'^[\s“"]+|[\s”"]+$', "", s).strip()


def _collapse_ws(s: str) -> str:
    return re.sub(r"\s*\n\s*", " ", s).strip()


def _strip_leading_id(text: str, seg_id: str = "") -> str:
    """Strip a leading "[id] " or "id. " prefix the model may have echoed back.

    Only strips a numeric prefix when it equals seg_id, so a body that
    legitimately begins with a number (e.g. "1. Life is a gift.") is left intact.
    """
    if not text:
        return ""
    text = text.strip()
    if seg_id:
        m = re.match(r"^\[?(\d+)\]?[\.\s\t]+", text)
        if m and m.group(1) == str(seg_id):
            return text[m.end():].strip()
        return text
    return _ID_PREFIX.sub("", text).strip()


def parse_copy(text: str) -> list[dict]:
    """Split raw copy into segments {id, chinese, english}. Mirrors front-end."""
    segments: list[dict] = []

    if re.search(r"^\d+\t", text, re.MULTILINE):  # TSV format
        starts = list(_TSV_ROW_START.finditer(text))
        for i, m in enumerate(starts):
            start = m.start()
            end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
            row = text[start:end]
            seg_id = m.group(1)
            without_id = row[len(seg_id) + 1:]
            tab_idx = without_id.find("\t")
            chinese, english = "", ""
            if tab_idx != -1:
                chinese = _strip_quotes(without_id[:tab_idx])
                english = _collapse_ws(_strip_quotes(without_id[tab_idx + 1:]))
            elif _CHINESE_TEST.search(without_id):
                chinese = _strip_quotes(without_id)
            else:
                english = _collapse_ws(_strip_quotes(without_id))
            segments.append({"id": seg_id, "chinese": chinese, "english": english})
    else:  # inline format
        matches = list(_SEG_RE.finditer(text))
        raw_segs: list[str] = []
        if not matches:
            raw_segs.append(text)
        else:
            for i, m in enumerate(matches):
                start = m.start() + len(m.group(1))
                end = (matches[i + 1].start() + len(matches[i + 1].group(1))
                       if i + 1 < len(matches) else len(text))
                raw_segs.append(text[start:end].strip())

        for seg in raw_segs:
            id_match = _ID_PREFIX.match(seg)
            id_str = id_match.group(1) if id_match else ""
            rest = seg[len(id_str):]
            last_cn = -1
            for i, ch in enumerate(rest):
                if _CHINESE_TEST.match(ch):
                    last_cn = i
            if last_cn != -1:
                tail = _TRAILING_PUNCT.match(rest[last_cn + 1:])
                if tail:
                    last_cn += len(tail.group(0))
            chinese = rest[:last_cn + 1].strip() if last_cn != -1 else ""
            english = _collapse_ws(rest[last_cn + 1:] if last_cn != -1 else rest)
            seg_id = re.sub(r"[\.\s\t]+$", "", id_str) if id_str else "1"
            segments.append({"id": seg_id, "chinese": chinese, "english": english})

    # Dedupe by id (keep first).
    seen: set[str] = set()
    unique: list[dict] = []
    for s in segments:
        if s["id"] not in seen:
            seen.add(s["id"])
            unique.append(s)
    return unique


_AUDIT_PROMPT = """你是一个专业的文案质检员。以下文案为基督教口播视频用途，包含神学术语和敬拜语言，请以此为背景进行质检。请对以下英文文案进行"AI 文案质检"。

待处理英文文案（每段以 [id] 形式给出段落标识）：
__BATCH__

质检要求：
__INSTR__

特别注意：
1. 每段开头的 [id] 只是段落标识，输出时不要包含它（例如输入 "[1] Hello"，输出 "Hello"）。
2. 仅对英文部分进行纠错。
3. 绝对不要纠正介词搭配。
4. 绝对不要进行风格润色或改写。
5. 正文中出现的所有数字一律原样保留，禁止删除或改动；尤其是 "1. ... 2. ... 3. ..." 这类内嵌的编号清单，它们是正文内容而非段落序号，必须完整保留。
6. 返回结果中包含：
   - id: 段落标识（即 [id] 中的数字）
   - originalEnglish: 原始英文部分（不含 [id]）
   - markupEnglish: 带有修改标记的英文（使用 ~~删除~~ 和 **新增** 标记差异，不含 [id]）
   - correctedEnglish: 修正后的纯净英文（不含 [id]）
7. 关于 markupEnglish 的关键规则：只标记【实际发生了改变】的词。如果原文某个词已经是正确的（例如 He、His、Your 已经大写），则不要用任何标记包裹它，直接原样输出。markupEnglish 中有标记的部分必须与 originalEnglish 和 correctedEnglish 之间的实际差异完全对应。

请以 JSON 数组格式返回结果。
示例格式：[{"id": "1", "originalEnglish": "...", "markupEnglish": "...", "correctedEnglish": "..."}]"""


def _generate_text(model: str, prompt: str) -> str:
    """Call Vertex Gemini with the model fallback chain, return text."""
    candidates = MODEL_FALLBACKS.get(model, [model])
    config = build_config({"responseMimeType": "application/json"})
    last_exc: Exception = RuntimeError("No models tried")
    for model_name in candidates:
        try:
            resp = client.models.generate_content(
                model=model_name,
                contents=[types.Part.from_text(text=prompt)],
                config=config,
            )
            return resp.text or ""
        except Exception as exc:  # noqa: BLE001
            print(f"[audit fallback] {model_name} failed: {exc}")
            last_exc = exc
    raise HTTPException(status_code=500, detail=str(last_exc))


def _parse_audit_json(text: str) -> list[dict]:
    clean = re.sub(r"^```json\n?", "", text).rstrip()
    clean = re.sub(r"```\n?$", "", clean).strip()
    start, end = clean.find("["), clean.rfind("]")
    if start != -1 and end != -1:
        clean = clean[start:end + 1]
    return json.loads(clean)


class AuditRequest(BaseModel):
    copy: str
    options: list[str] = []
    instructions: dict[str, str] = {}


def _require_auth(token: str) -> None:
    if ACCESS_CODE and not hmac.compare_digest(token, _make_token(ACCESS_CODE)):
        raise HTTPException(status_code=401, detail="未授权，请刷新页面重新登录")


@app.post("/api/audit")
async def audit(req: AuditRequest, x_access_token: str = Header(default="")):
    _require_auth(x_access_token)

    active_instructions = "\n".join(
        f"- {'自定义指令' if oid == 'custom' else oid}: {req.instructions.get(oid, '')}"
        for oid in req.options
    )

    segments = parse_copy(req.copy)
    results: list[dict] = []
    batch_size = 15

    for i in range(0, len(segments), batch_size):
        batch = segments[i:i + batch_size]
        auditable = [s for s in batch if s["english"].strip()]
        if not auditable:
            continue

        batch_text = "\n\n".join(f"[{s['id']}] {s['english']}" for s in auditable)
        prompt = _AUDIT_PROMPT.replace("__BATCH__", batch_text).replace(
            "__INSTR__", active_instructions
        )

        text = _generate_text("gemini-3-flash-preview", prompt)
        if not text:
            raise HTTPException(status_code=500, detail="AI 返回了空响应。")

        by_id = {s["id"]: s for s in auditable}
        for res in _parse_audit_json(text):
            local = by_id.get(str(res.get("id")), auditable[0])
            if any(r["id"] == str(res.get("id")) for r in results):
                continue
            corrected = _strip_leading_id(res.get("correctedEnglish", ""), str(res.get("id")))
            results.append({
                "id": str(res.get("id")),
                "chinese": local["chinese"],
                "originalEnglish": _strip_leading_id(res.get("originalEnglish", ""), str(res.get("id"))),
                "markupEnglish": _strip_leading_id(res.get("markupEnglish", ""), str(res.get("id"))),
                "correctedEnglish": corrected,
                "qcEnglishHasChinese": _has_chinese(corrected),
            })

    session_id = uuid.uuid4().hex
    save_session(session_id, {
        "sessionId": session_id,
        "createdAt": int(time.time()),
        "results": results,
        # Canonical corrected copy Hermes matches images against.
        "copyForMatch": [
            {"id": r["id"], "chinese": r["chinese"], "english": r["correctedEnglish"]}
            for r in results
        ],
    })
    return {"sessionId": session_id, "results": results}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str, x_access_token: str = Header(default="")):
    _require_auth(x_access_token)
    data = load_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="session 不存在或已过期")
    return data


class MatchMapRequest(BaseModel):
    # { copyId -> imageFilename }
    matchMap: dict[str, str]


@app.put("/api/session/{session_id}/match")
async def put_match(
    session_id: str,
    req: MatchMapRequest,
    x_access_token: str = Header(default=""),
):
    """Hermes writes the image↔copy match result back for human review."""
    _require_auth(x_access_token)
    data = load_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="session 不存在或已过期")
    data["matchMap"] = req.matchMap
    data["matchedAt"] = int(time.time())
    save_session(session_id, data)
    return {"ok": True, "count": len(req.matchMap)}


@app.get("/api/session/{session_id}/match")
async def get_match(session_id: str, x_access_token: str = Header(default="")):
    """UI pulls the matchMap Hermes wrote, to render the visual review grid."""
    _require_auth(x_access_token)
    data = load_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="session 不存在或已过期")
    return {
        "matchMap": data.get("matchMap", {}),
        "matchedAt": data.get("matchedAt"),
        "confirmed": data.get("confirmed", False),
        "confirmedAt": data.get("confirmedAt"),
    }


# ── Image upload / listing / download (for a remote Hermes) ──────────────────

class UploadFile(BaseModel):
    name: str
    contentType: str = "image/jpeg"


class UploadUrlsRequest(BaseModel):
    files: list[UploadFile]


@app.post("/api/session/{session_id}/upload-urls")
async def upload_urls(
    session_id: str,
    req: UploadUrlsRequest,
    x_access_token: str = Header(default=""),
):
    """Issue v4 signed PUT URLs so the browser uploads images straight to GCS."""
    _require_auth(x_access_token)
    return {"uploads": [
        {
            "name": f.name,
            "contentType": f.contentType,
            "uploadUrl": signed_put_url(session_id, f.name, f.contentType),
        }
        for f in req.files
    ]}


@app.get("/api/session/{session_id}/images")
async def get_images(session_id: str, x_access_token: str = Header(default="")):
    """List images uploaded under a session (name + gs:// URI for matching)."""
    _require_auth(x_access_token)
    return {"images": list_session_images(session_id)}


@app.get("/api/session/{session_id}/image/{name}")
async def download_image(
    session_id: str, name: str, x_access_token: str = Header(default="")
):
    """Proxy the raw image bytes (used by Hermes to pull confirmed results)."""
    _require_auth(x_access_token)
    blob = _image_blob(session_id, name)
    if not blob.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    return Response(
        content=blob.download_as_bytes(),
        media_type=blob.content_type or "application/octet-stream",
    )


@app.post("/api/session/{session_id}/confirm")
async def confirm_match(
    session_id: str,
    req: MatchMapRequest,
    x_access_token: str = Header(default=""),
):
    """UI writes back the human-confirmed (possibly hand-corrected) matchMap."""
    _require_auth(x_access_token)
    data = load_session(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="session 不存在或已过期")
    data["matchMap"] = req.matchMap
    data["confirmed"] = True
    data["confirmedAt"] = int(time.time())
    save_session(session_id, data)
    return {"ok": True, "count": len(req.matchMap)}


# ── Serve compiled React SPA ──────────────────────────────────────────────────
DIST = "dist"
if os.path.isdir(DIST) and os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=f"{DIST}/assets"), name="assets")


_DIST_REAL = os.path.realpath(DIST)

@app.get("/{full_path:path}")
async def spa(full_path: str):
    candidate = os.path.realpath(os.path.join(DIST, full_path))
    if full_path and os.path.isfile(candidate) and candidate.startswith(_DIST_REAL + os.sep):
        return FileResponse(candidate)
    return FileResponse(os.path.join(DIST, "index.html"))
