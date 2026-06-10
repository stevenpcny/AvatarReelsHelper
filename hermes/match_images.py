#!/usr/bin/env python3
"""
Hermes-side image↔copy tool (runs on a DIFFERENT machine than the user).

Images live in the user's browser/local disk and are uploaded to GCS (under the
session) from the UI. This remote tool therefore never touches the user's disk
during matching — it works off the GCS copies.

Modes:
  --mode match     (default)
      1. login → GET audited copy + uploaded image list (gs:// URIs)
      2. ask a vision model to map each copyId → best image filename
         (Vertex reads gs:// directly; no base64 upload from Hermes)
      3. PUT the matchMap back for human review in the UI
  --mode finalize
      After the user reviews & clicks "确认匹配" in the UI:
      1. GET the confirmed matchMap (refuses if not confirmed)
      2. download each matched image from the backend
      3. write renamed files {id}_{中文}.{ext} + copy.tsv into --out
         for downstream processing on Hermes's local machine

Vision engine (match mode) is user-configurable:
  --engine software  (default) reuse this app's /api/generate (Vertex Gemini)
  --engine custom    plug in your own model in match_custom()

Examples:
  python hermes/match_images.py --mode match    --session <SID> --code 19911991
  python hermes/match_images.py --mode finalize --session <SID> --code 19911991 \
      --out ./out

Stdlib only (certifi used if present for TLS).
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://avatar-reels-helper-76842936864.us-west1.run.app"
DEFAULT_RULES = "根据文案的情感基调和核心关键词，匹配最符合意境的图片。"


def _ssl_context() -> ssl.SSLContext:
    """certifi CA bundle when available (fixes macOS python.org installs without
    system CA certs). HERMES_INSECURE=1 disables verification."""
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


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _request(method: str, url: str, token: str | None = None,
             payload: dict | None = None, raw: bool = False):
    headers = {}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    if token:
        headers["x-access-token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=180, context=_SSL) as resp:
        body = resp.read()
    return body if raw else json.loads(body.decode())


def login(base_url: str, code: str) -> str:
    return _request("POST", f"{base_url}/api/auth/login", payload={"code": code})["token"]


# ── Vision engines (match mode) ──────────────────────────────────────────────

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
                   copy_entries: list[dict], images: list[dict], rules: str) -> dict:
    """Reuse the app's /api/generate; Vertex reads each gs:// URI directly."""
    parts: list = []
    for img in images:
        parts.append({"text": f"Image filename: {img['name']}"})
        parts.append({"fileData": {"fileUri": img["gsUri"], "mimeType": img["mime"]}})
    parts.append({"text": _build_prompt(copy_entries, [i["name"] for i in images], rules)})

    resp = _request("POST", f"{base_url}/api/generate", token, {
        "model": model,
        "contents": {"parts": parts},
        "config": {"responseMimeType": "application/json"},
    })
    return _parse_match(resp.get("text", ""), {i["name"] for i in images})


def match_custom(copy_entries: list[dict], images: list[dict], rules: str) -> dict:
    """Plug your own Hermes vision model here. `images` carry gsUri/name/mime.
    Return {copyId: filename}. Left unimplemented — only you know your SDK."""
    raise NotImplementedError(
        "自定义模型引擎尚未配置。请在 match_custom() 中接入你的视觉模型，或用 --engine software。"
    )


def _parse_match(text: str, valid_names: set[str]) -> dict:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("```", 2)[1]
        clean = clean[4:] if clean.lower().startswith("json") else clean
    start, end = clean.find("["), clean.rfind("]")
    if start != -1 and end != -1:
        clean = clean[start:end + 1]
    match_map: dict[str, str] = {}
    for item in json.loads(clean):
        cid, fname = str(item.get("copyId")), item.get("filename")
        if fname in valid_names:
            match_map[cid] = fname
        else:
            print(f"  ⚠ 模型返回了不存在的文件名，已跳过: copyId={cid} -> {fname}",
                  file=sys.stderr)
    return match_map


# ── Modes ────────────────────────────────────────────────────────────────────

def run_match(args, base_url: str, token: str) -> int:
    print(f"→ 拉取 session {args.session} 的校验后文案")
    session = _request("GET", f"{base_url}/api/session/{args.session}", token)
    copy_entries = session.get("copyForMatch", [])
    if not copy_entries:
        print("该 session 没有可匹配的文案 (copyForMatch 为空)", file=sys.stderr)
        return 1

    images = _request("GET", f"{base_url}/api/session/{args.session}/images", token)["images"]
    if not images:
        print("该 session 下没有已上传的图片 —— 请先在 UI 上传图片。", file=sys.stderr)
        return 1
    print(f"  文案 {len(copy_entries)} 条，图片 {len(images)} 张")

    print(f"→ 匹配中 (engine={args.engine}, model={args.model})")
    if args.engine == "software":
        match_map = match_software(base_url, token, args.model, copy_entries, images, args.rules)
    else:
        match_map = match_custom(copy_entries, images, args.rules)

    print(f"  得到 {len(match_map)} 条匹配:")
    for cid, fname in _sorted_items(match_map):
        print(f"    copyId {cid} → {fname}")

    if args.dry_run:
        print("→ dry-run，未回写。")
        return 0
    res = _request("PUT", f"{base_url}/api/session/{args.session}/match", token,
                   {"matchMap": match_map})
    print(f"✓ 已写回 {res.get('count')} 条。到 UI 点「载入 Hermes 匹配」校验并确认。")
    return 0


def run_finalize(args, base_url: str, token: str) -> int:
    if not args.out:
        print("finalize 需要 --out 指定输出文件夹", file=sys.stderr)
        return 2

    match = _request("GET", f"{base_url}/api/session/{args.session}/match", token)
    if not match.get("confirmed"):
        print("该 session 尚未在 UI 中点「确认匹配」，拒绝 finalize。", file=sys.stderr)
        return 1
    match_map = match.get("matchMap", {})
    if not match_map:
        print("确认版 matchMap 为空。", file=sys.stderr)
        return 1

    session = _request("GET", f"{base_url}/api/session/{args.session}", token)
    chinese_by_id = {e["id"]: e.get("chinese", "") for e in session.get("copyForMatch", [])}
    english_by_id = {e["id"]: e.get("english", "") for e in session.get("copyForMatch", [])}

    os.makedirs(args.out, exist_ok=True)
    print(f"→ 下载 {len(match_map)} 张确认图片到 {args.out}")
    for cid, fname in _sorted_items(match_map):
        ext = os.path.splitext(fname)[1] or ".jpg"
        label = _sanitize(chinese_by_id.get(cid, "")) or cid
        out_name = f"{cid}_{label}{ext}"
        data = _request("GET", f"{base_url}/api/session/{args.session}/image/{fname}",
                        token, raw=True)
        with open(os.path.join(args.out, out_name), "wb") as f:
            f.write(data)
        print(f"    {fname} → {out_name}")

    # copy.tsv for downstream processing
    rows = ["#id#\tchinese\tenglish"]
    for cid in sorted(chinese_by_id, key=lambda x: int(x) if x.isdigit() else 0):
        rows.append(f"#{cid}#\t{chinese_by_id[cid]}\t{english_by_id.get(cid, '')}")
    with open(os.path.join(args.out, "copy.tsv"), "w", encoding="utf-8") as f:
        f.write("\n".join(rows))
    print(f"✓ 完成。成品在 {args.out}（含 copy.tsv）。")
    return 0


def _sorted_items(d: dict):
    return sorted(d.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0)


def _sanitize(text: str, max_chars: int = 50) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\n\r\t]', "", text).strip()
    return cleaned[:max_chars]


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Hermes image↔copy tool")
    ap.add_argument("--mode", choices=["match", "finalize"], default="match")
    ap.add_argument("--base-url", default=os.getenv("HERMES_BASE_URL", DEFAULT_BASE_URL))
    ap.add_argument("--code", default=os.getenv("HERMES_ACCESS_CODE"),
                    help="访问码 (或设 HERMES_ACCESS_CODE)")
    ap.add_argument("--session", required=True, help="文案校验后的 session id")
    ap.add_argument("--engine", choices=["software", "custom"], default="software")
    ap.add_argument("--model", default="gemini-3-flash-preview")
    ap.add_argument("--rules", default=DEFAULT_RULES, help="自定义匹配规则")
    ap.add_argument("--out", help="finalize 模式的输出文件夹")
    ap.add_argument("--dry-run", action="store_true", help="match 模式只打印不回写")
    args = ap.parse_args()

    if not args.code:
        print("缺少访问码：--code 或环境变量 HERMES_ACCESS_CODE", file=sys.stderr)
        return 2

    print(f"→ 登录 {args.base_url}")
    token = login(args.base_url, args.code)
    return run_match(args, args.base_url, token) if args.mode == "match" \
        else run_finalize(args, args.base_url, token)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode(errors='replace')}", file=sys.stderr)
        sys.exit(1)
