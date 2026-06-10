#!/usr/bin/env python3
"""
Hermes-side image↔copy matcher.

Pipeline (matches the "B. Hermes 发起" design):
  1. Log in to the AvatarReelsHelper backend, get a day-scoped token.
  2. GET the audited copy for a session (server-side 校验后文案).
  3. Read images from a local folder.
  4. Ask a vision model to map each copy entry → best image filename.
  5. PUT the matchMap back to the session, so the human can open the UI,
     click "载入 Hermes 匹配", and visually verify image↔copy correctness.

Vision engine is user-configurable:
  --engine software  (default) reuse this app's /api/generate (Vertex Gemini)
  --engine custom    plug in your own Hermes model in `match_custom()`

Usage:
  python hermes/match_images.py \
      --session <SESSION_ID> \
      --images /path/to/image/folder \
      --code 19911991

Only depends on the Python stdlib.
"""

import argparse
import base64
import json
import mimetypes
import os
import ssl
import sys
import urllib.error
import urllib.request


def _ssl_context() -> ssl.SSLContext:
    """Use certifi's CA bundle when available (fixes macOS python.org installs
    that ship without system CA certs). HERMES_INSECURE=1 disables verification."""
    if os.getenv("HERMES_INSECURE") == "1":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL = _ssl_context()

DEFAULT_BASE_URL = "https://avatar-reels-helper-76842936864.us-west1.run.app"
IMAGE_EXTS = (".jpg", ".jpeg", ".png")
DEFAULT_RULES = "根据文案的情感基调和核心关键词，匹配最符合意境的图片。"


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _post(url: str, payload: dict, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["x-access-token"] = token
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=180, context=_SSL) as resp:
        return json.loads(resp.read().decode())


def _put(url: str, payload: dict, token: str) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-access-token": token},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=60, context=_SSL) as resp:
        return json.loads(resp.read().decode())


def _get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"x-access-token": token}, method="GET")
    with urllib.request.urlopen(req, timeout=60, context=_SSL) as resp:
        return json.loads(resp.read().decode())


def login(base_url: str, code: str) -> str:
    return _post(f"{base_url}/api/auth/login", {"code": code})["token"]


# ── Image loading ────────────────────────────────────────────────────────────

def load_images(folder: str) -> list[dict]:
    images = []
    for name in sorted(os.listdir(folder)):
        if name.startswith(".") or not name.lower().endswith(IMAGE_EXTS):
            continue
        path = os.path.join(folder, name)
        mime = mimetypes.guess_type(name)[0] or "image/jpeg"
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
        images.append({"name": name, "mime": mime, "data": data})
    return images


# ── Vision engines ───────────────────────────────────────────────────────────

def _build_prompt(copy_entries: list[dict], image_names: list[str], rules: str) -> str:
    copy_lines = "\n".join(
        f'  - copyId={e["id"]}: [中文]{e.get("chinese","")} [英文]{e.get("english","")}'
        for e in copy_entries
    )
    name_lines = "\n".join(f"  - {n}" for n in image_names)
    return f"""You are an AI matching tool. Match each copy entry to the single most
appropriate image filename, based on emotion, theme and the custom rules.

Copy entries:
{copy_lines}

Available image filenames (each shown below as an image):
{name_lines}

Custom matching rules:
{rules}

Rules:
1. Every copyId MUST be assigned exactly one filename from the list above.
2. Multiple copyIds MAY share the same filename if appropriate.
3. Return ONLY a JSON array, no prose:
   [{{"copyId": "1", "filename": "exact_name.jpg"}}, ...]
"""


def match_software(base_url: str, token: str, model: str,
                   copy_entries: list[dict], images: list[dict],
                   rules: str) -> dict:
    """Reuse the app's /api/generate (Vertex Gemini)."""
    parts: list = []
    for img in images:
        parts.append({"text": f"Image filename: {img['name']}"})
        parts.append({"inlineData": {"data": img["data"], "mimeType": img["mime"]}})
    parts.append({"text": _build_prompt(copy_entries, [i["name"] for i in images], rules)})

    resp = _post(
        f"{base_url}/api/generate",
        {"model": model, "contents": {"parts": parts},
         "config": {"responseMimeType": "application/json"}},
        token,
    )
    text = resp.get("text", "")
    return _parse_match(text, {i["name"] for i in images})


def match_custom(copy_entries: list[dict], images: list[dict], rules: str) -> dict:
    """Plug your own Hermes vision model here.

    Build the prompt with `_build_prompt(...)`, send `images` (name/mime/data)
    to your model, then return a {copyId: filename} dict. Left unimplemented on
    purpose — only you know your model's SDK.
    """
    raise NotImplementedError(
        "自定义模型引擎尚未配置。请在 hermes/match_images.py 的 match_custom() "
        "中接入你的视觉模型，或改用 --engine software。"
    )


def _parse_match(text: str, valid_names: set[str]) -> dict:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("```", 2)[1]
        clean = clean[4:] if clean.lower().startswith("json") else clean
    start, end = clean.find("["), clean.rfind("]")
    if start != -1 and end != -1:
        clean = clean[start:end + 1]
    arr = json.loads(clean)
    match_map: dict[str, str] = {}
    for item in arr:
        cid, fname = str(item.get("copyId")), item.get("filename")
        if fname in valid_names:
            match_map[cid] = fname
        else:
            print(f"  ⚠ 模型返回了不存在的文件名，已跳过: copyId={cid} -> {fname}",
                  file=sys.stderr)
    return match_map


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Hermes image↔copy matcher")
    ap.add_argument("--base-url", default=os.getenv("HERMES_BASE_URL", DEFAULT_BASE_URL))
    ap.add_argument("--code", default=os.getenv("HERMES_ACCESS_CODE"),
                    help="访问码 (或设 HERMES_ACCESS_CODE)")
    ap.add_argument("--session", required=True, help="文案校验后的 session id")
    ap.add_argument("--images", required=True, help="本地图片文件夹路径")
    ap.add_argument("--engine", choices=["software", "custom"], default="software")
    ap.add_argument("--model", default="gemini-3-flash-preview")
    ap.add_argument("--rules", default=DEFAULT_RULES, help="自定义匹配规则")
    ap.add_argument("--dry-run", action="store_true", help="只打印 matchMap，不回写")
    args = ap.parse_args()

    if not args.code:
        print("缺少访问码：--code 或环境变量 HERMES_ACCESS_CODE", file=sys.stderr)
        return 2
    if not os.path.isdir(args.images):
        print(f"图片文件夹不存在: {args.images}", file=sys.stderr)
        return 2

    print(f"→ 登录 {args.base_url}")
    token = login(args.base_url, args.code)

    print(f"→ 拉取 session {args.session} 的校验后文案")
    session = _get(f"{args.base_url}/api/session/{args.session}", token)
    copy_entries = session.get("copyForMatch", [])
    if not copy_entries:
        print("该 session 没有可匹配的文案 (copyForMatch 为空)", file=sys.stderr)
        return 1
    print(f"  共 {len(copy_entries)} 条文案")

    images = load_images(args.images)
    if not images:
        print(f"文件夹内没有图片 (支持 {IMAGE_EXTS})", file=sys.stderr)
        return 1
    print(f"→ 载入 {len(images)} 张图片")

    print(f"→ 匹配中 (engine={args.engine}, model={args.model})")
    if args.engine == "software":
        match_map = match_software(args.base_url, token, args.model,
                                   copy_entries, images, args.rules)
    else:
        match_map = match_custom(copy_entries, images, args.rules)

    print(f"  得到 {len(match_map)} 条匹配:")
    for cid, fname in sorted(match_map.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
        print(f"    copyId {cid} → {fname}")

    if args.dry_run:
        print("→ dry-run，未回写。")
        return 0

    print("→ 回写 matchMap")
    res = _put(f"{args.base_url}/api/session/{args.session}/match",
               {"matchMap": match_map}, token)
    print(f"✓ 完成，已写回 {res.get('count')} 条。现在到 UI 点「载入 Hermes 匹配」校验。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode(errors='replace')}", file=sys.stderr)
        sys.exit(1)
