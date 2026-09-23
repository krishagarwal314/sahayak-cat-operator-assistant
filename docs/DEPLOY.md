# Running and demonstrating Sahayak

## The one constraint that decides everything

**The microphone only works on a secure origin.** Browsers block `getUserMedia`
on plain `http://` unless the host is `localhost`. Your browser runs on your
laptop; the server runs in the cloud; so you need an **HTTPS URL**, not an IP
address and port.

Everything below is arranged around that. The app is built to serve the
frontend and the API from a single port precisely so one HTTPS tunnel is all you
need.

---

## Lightning AI or Colab?

**Use Lightning AI for a scheduled demo.** The deciding factor is not compute,
it is persistence: Lightning keeps its filesystem between sessions, so you
download the 3.5 GB of models once. Colab wipes everything when the runtime
recycles, and it recycles when idle — which is exactly what happens while you
are waiting to present.

| | Lightning AI Studio | Google Colab |
|---|---|---|
| Models survive a restart | yes, persistent disk | no, re-download every session |
| Idle disconnect | studio sleeps, disk kept | runtime destroyed, start over |
| HTTPS for the mic | built-in port sharing | needs a cloudflared tunnel |
| Terminal | real, persistent | notebook cells only |
| Good for | the actual demo | a quick first run |

Colab is a perfectly good way to see it working today. Just do not schedule a
presentation around it.

GPU is optional either way. On CPU a spoken question takes roughly 3-5 seconds
end to end; on a T4 it is comfortably under a second. For a live demo in front
of people, take the GPU.

---

## Lightning AI — the recommended path

1. Create a Studio, pick **GPU (T4)**, and open the terminal.

2. Clone and set up. One command does ffmpeg, Python deps, the frontend build
   and the model downloads:

   ```bash
   git clone https://github.com/krishagarwal314/sahayak-cat-operator-assistant.git
   cd sahayak-cat-operator-assistant
   bash scripts/setup_cloud.sh
   ```

3. Train the intent classifier. Optional — the router works without it and just
   skips stage L3 — but it is three minutes on a GPU and it is the one model the
   project actually owns, so it is worth having in the demo:

   ```bash
   cd backend
   python -m app.ai.intent.build_dataset
   python -m app.ai.intent.train --epochs 6
   ```

4. Start the server. `EAGER_LOAD_MODELS=1` loads everything at boot so your
   first question on stage is not the slow one:

   ```bash
   EAGER_LOAD_MODELS=1 python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

5. Share port 8000 from the Studio UI. Lightning gives you an HTTPS URL. Open
   it, sign in with `OP1001 / cat1234`.

To keep the Studio warm before a demo, start it 20 minutes early and leave the
tab open.

---

## Colab

Open `notebooks/sahayak_colab.ipynb` in Colab and run the cells top to bottom.
It clones the repo, runs the same setup script, trains the classifier, starts
the server and opens a Cloudflare tunnel, then prints the HTTPS link.

Direct link, once the repo is public:

```
https://colab.research.google.com/github/krishagarwal314/sahayak-cat-operator-assistant/blob/main/notebooks/sahayak_colab.ipynb
```

Set **Runtime → Change runtime type → T4 GPU** first.

---

## Any other Linux box

```bash
git clone https://github.com/krishagarwal314/sahayak-cat-operator-assistant.git
cd sahayak-cat-operator-assistant
bash scripts/setup_cloud.sh

cd backend
EAGER_LOAD_MODELS=1 python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then, in a second terminal, for an HTTPS origin with no signup:

```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
cloudflared tunnel --url http://localhost:8000
```

It prints a `https://something.trycloudflare.com` URL. That is the one to open.

---

## Pre-demo checklist

Run through this **before** you are in front of anyone.

```bash
# 1. every model actually loaded - nothing should say FAILED
curl -s localhost:8000/api/system/models | python -m json.tool | head -30
```

- [ ] All five roles report loaded, not failed
- [ ] The HTTPS URL opens on your **laptop**, not just inside the cloud IDE
- [ ] Browser asked for microphone permission and you allowed it
- [ ] You held the mic button, said *"कितना ईंधन बचा है"*, and heard a Hindi reply
- [ ] The speaker button on the Shift page reads the briefing aloud
- [ ] Switching to the loader and asking about hydraulic temperature gives the
      polite refusal
- [ ] Insights page shows a non-zero question count and zero LLM calls
- [ ] Laptop volume is up and, if the room is large, connected to speakers

Reset to a clean state between run-throughs:

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"OP1001","password":"cat1234"}' | python -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:8000/api/system/reset -H "Authorization: Bearer $TOKEN"
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Mic button does nothing, no permission prompt | Page is on `http://`, not HTTPS | Use the tunnel URL. This is the single most common failure. |
| `Due to a serious vulnerability issue in torch.load` | torch < 2.6 and the Hindi Whisper checkpoint is pickle-only | `pip install -U torch`, or set `STT_MODEL=openai/whisper-small` which ships safetensors |
| STT returns 503 | Speech model not downloaded | `python scripts/download_models.py --only stt`. The UI falls back to browser recognition meanwhile. |
| No audio comes back | TTS model missing | The browser synthesises instead, so the demo continues. Fix with `--only tts`. |
| `ffmpeg not found` when you speak | Browser sends webm/opus, which needs ffmpeg to decode | `apt-get install -y ffmpeg` |
| `translate unavailable -> No module named 'transformers.onnx'` | IndicTrans2's remote code imports a module transformers v5 removed | Use the default `facebook/nllb-200-distilled-600M`, or pin `transformers<5`. **Not demo-blocking.** |
| `translate unavailable -> gated repo` / 401 | IndicTrans2 requires accepting terms on the Hub | Accept at [the model page](https://huggingface.co/ai4bharat/indictrans2-en-indic-dist-200M) and `export HF_TOKEN=hf_...`. Easier: stay on the ungated NLLB default. **Not demo-blocking** — task text falls back to curated Hindi in `seed/tasks_hi.json`. |
| Task text is in English, not Hindi | IndicTransToolkit missing *and* no curated Hindi for that task | `pip install IndicTransToolkit`. Only affects tasks you add yourself; the six seeded ones always have Hindi. |
| First question takes 20 seconds | Models loading lazily on first use | Restart with `EAGER_LOAD_MODELS=1`, or press **Warm up models** on Insights |
| Frontend shows the JSON API response | `frontend/dist` was never built | `cd frontend && npm run build`, then restart the server |
| Out of memory loading models | Too small an instance for the `quality` profile | `MODEL_PROFILE=lite` or the default `balanced` |
| Tunnel URL died mid-demo | Quick tunnels are ephemeral | Restart cloudflared; on Lightning use the Studio's own port sharing instead |

---

## Making it faster

- `MODEL_PROFILE=quality` on a GPU box gives noticeably better Hindi speech
  (whisper-hindi-medium and IndicF5), at roughly 9 GB of downloads. IndicF5 also
  needs `pip install f5-tts` and a reference clip — see the README.
- `MODEL_PROFILE=lite` cuts the footprint to about 1.2 GB if the box is small.
- The intent router is unaffected by all of this. It answers in about a
  millisecond on any hardware, because it is not a model.
