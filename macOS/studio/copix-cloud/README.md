# Copix Cloud

Lightweight OpenAI-compatible proxy between **Copix Studio** and your model backend. The proxy itself fits free-tier hosting (Render, Fly.io, Railway); **20B inference does not** — see [Limits](#honest-limits).

```
Copix Studio  →  HTTPS + COPIX_API_KEY  →  copix-cloud  →  Ollama VPS / HF API
```

## Quick local test

```powershell
cd studio/copix-cloud
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: set COPIX_API_KEY and OLLAMA_URL (local Ollama: http://127.0.0.1:11434)
python main.py
```

Health: `http://127.0.0.1:8080/health`  
Chat: `POST http://127.0.0.1:8080/v1/chat/completions` with `Authorization: Bearer <COPIX_API_KEY>`

In Copix Studio → Settings → gpt-oss → **Cloud (Copix proxy)**:
- Endpoint: `http://127.0.0.1:8080/v1`
- API key: same as `COPIX_API_KEY`

---

## Deploy to Render (free tier)

1. Push this repo to GitHub.
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect repo, select `studio/copix-cloud/render.yaml`.
3. Set env vars:
   - `COPIX_API_KEY` — long random string (Render can auto-generate).
   - `OLLAMA_URL` — URL of Ollama on your VPS, e.g. `http://100.x.x.x:11434` (see VPS below).
   - `DEFAULT_MODEL` — `gpt-oss:20b` or `copix-gpt-oss` if exported on that Ollama.
4. Deploy. Copy the service URL, e.g. `https://copix-cloud-xxxx.onrender.com`.
5. In Studio: endpoint `https://copix-cloud-xxxx.onrender.com/v1`, API key = `COPIX_API_KEY`.

**Note:** Render free web services spin down after ~15 min idle; first request may take 30–60s to cold-start.

---

## Deploy to Fly.io (free allowance)

```bash
cd studio/copix-cloud
fly launch --no-deploy
fly secrets set COPIX_API_KEY=your-secret-key
fly secrets set OLLAMA_URL=http://your-vps:11434
fly deploy
```

Studio endpoint: `https://<app-name>.fly.dev/v1`

---

## Deploy to Railway

1. New project → **Deploy from GitHub** → root directory `studio/copix-cloud`.
2. Railway detects Dockerfile automatically.
3. Variables: `COPIX_API_KEY`, `OLLAMA_URL`, `DEFAULT_MODEL`, `PORT` (Railway sets `PORT` automatically).
4. Public URL + `/v1` in Studio.

---

## Recommended: Ollama on a $5 VPS (Hetzner, DigitalOcean, etc.)

A 20B model needs **~16GB+ RAM** (quantized). Free PaaS cannot host it; run Ollama on a small VPS:

```bash
# On Ubuntu VPS (example)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gpt-oss:20b
# Optional: export your tuned model from Copix and scp Modelfile, then ollama create copix-gpt-oss
```

Expose Ollama to the proxy only (not the public internet):

- **Tailscale** (easiest): install on VPS and on your dev machine; use `http://100.x.x.x:11434` as `OLLAMA_URL`.
- **Private network**: Fly.io/Railway private networking to VPS if supported.
- **Firewall**: if you must use public IP, restrict port 11434 to the proxy’s egress IPs only.

Set `OLLAMA_URL=http://<vps-tailscale-ip>:11434` on copix-cloud.

---

## Hugging Face backend (alternative)

For users without a VPS — uses HF Inference (paid credits after free tier; rate limits apply):

```env
BACKEND=huggingface
HF_TOKEN=hf_...
HF_MODEL=openai/gpt-oss-20b
```

Tool calling quality may differ from local Ollama. Your **copix-gpt-oss** LoRA is not available here unless you merge and upload to HF.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPIX_API_KEY` | *(required)* | Secret Studio sends as Bearer token |
| `BACKEND` | `ollama` | `ollama` or `huggingface` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL (no `/v1`) |
| `DEFAULT_MODEL` | `gpt-oss:20b` | Model id when client omits `model` |
| `HF_TOKEN` | — | Required for `huggingface` backend |
| `HF_MODEL` | `openai/gpt-oss-20b` | HF model id |
| `RATE_LIMIT_PER_MIN` | `30` | Per-IP requests/minute |
| `PORT` | `8080` | Listen port |

---

## Honest limits

| Goal | Free tier realistic? | Recommendation |
|------|----------------------|----------------|
| Host **copix-cloud proxy** | Yes (Render/Fly/Railway) | ~512MB RAM is enough |
| Run **gpt-oss 20B** on same free host | **No** | Needs 16GB+ RAM GPU/VPS |
| **copix-gpt-oss** tuned model in cloud | Only on **your** Ollama VPS | Train locally, export, `ollama create` on VPS |
| HF **gpt-oss-20b** without VPS | Partially | HF free credits + limits; no custom LoRA unless you upload |
| Cold starts (Render free) | Slow | Use Fly `min_machines_running=1` (not free) or accept delay |

**Practical paths:**

1. **Best quality:** $5–12/mo VPS + Ollama + copix-cloud proxy on Render (offloads GPU from laptop).
2. **No VPS:** HF backend + base `openai/gpt-oss-20b` (no tuned model).
3. **Local only:** Keep Studio on `http://127.0.0.1:11434/v1` (current default).

---

## API

- `GET /health` — no auth; shows backend status.
- `GET /v1/models` — Bearer auth.
- `POST /v1/chat/completions` — Bearer auth; OpenAI-compatible streaming.

Copix Studio already calls `/v1/chat/completions` with tools + `stream: true`.
