# Sahayak — Smart Operator Assistant for CAT Machines

A machine-aware, voice-first assistant for construction equipment operators. The
operator signs in, hears the day's tasks read out in Hindi, picks a machine by
voice or by tapping, and then asks that machine questions in their own language.

The point of the build is the routing layer in the middle: **a large language
model is never in the request path.** Questions are answered from structured
machine data through a staged local router, which is why answers come back in
milliseconds, cost nothing per query, and say exactly the same thing every time.

```
Operator speech ─► STT (Hindi) ─► Intent router ─► Machine data ─► Hindi template ─► TTS ─► Spoken answer
                                       │
                          L0 quick action   0 ms   the UI already knows the intent
                          L1 rules         <1 ms   token keyword match
                          L2 embeddings   ~15 ms   cosine kNN over a prototype bank
                          L3 classifier   ~25 ms   fine-tuned MuRIL head
                          L4 clarify        0 ms   ask, rather than guess
```

Each stage answers only if it is confident; otherwise it hands the question down
with what it learned. The UI renders the whole trace, so the routing is visible
rather than magic.

---

## Run it in the cloud

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/krishagarwal314/sahayak-cat-operator-assistant/blob/main/notebooks/sahayak_colab.ipynb)

```bash
git clone https://github.com/krishagarwal314/sahayak-cat-operator-assistant.git
cd sahayak-cat-operator-assistant
bash scripts/setup_cloud.sh          # ffmpeg, deps, frontend build, models

cd backend
EAGER_LOAD_MODELS=1 python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API serves the built frontend, so that is **one port and one URL**. Expose it
over HTTPS — the microphone will not work otherwise. `docs/DEPLOY.md` covers
Lightning AI (recommended for a scheduled demo, because its disk persists and
the models download once), Colab, tunnelling, and a pre-demo checklist.

---

## Local development

```bash
# 1. dependencies
make setup                 # backend venv + npm install

# 2. models (about 3.5 GB for the default profile)
cd backend && .venv/bin/python scripts/download_models.py

# 3. train the one model this project owns
.venv/bin/python -m app.ai.intent.build_dataset
.venv/bin/python -m app.ai.intent.train

# 4. run
cd .. && ./run.sh          # backend :8000, frontend :5173
```

**It runs with no models downloaded at all.** Speech, translation and the
embedding stage degrade instead of crashing: the keyword router still answers
every question, the browser's own speech synthesis reads the replies, and task
text falls back to curated Hindi. Use `./run.sh --no-models` to start that way
deliberately.

Sign in with `OP1001` / `cat1234` (the login screen lists every demo account).

---

## Models

Nothing here is trained from scratch except the intent classifier. Everything
else is a published checkpoint, chosen to be a proven Hindi performer without
being enormous — the whole default set is ~3.5 GB.

| Role | Default (`balanced`) | Why this one |
|---|---|---|
| Speech to text | `vasista22/whisper-hindi-small` | Hindi fine-tune; far better on Indian-accented Hindi than vanilla Whisper at the same 244M size |
| Text to speech | `facebook/mms-tts-hin` | VITS, 145M, sub-second on CPU, needs no prompt audio |
| Translation en→hi | `facebook/nllb-200-distilled-600M` | Native to transformers, ungated, no extra toolkit. IndicTrans2 is better on en→hi but cannot load on transformers v5 — see below |
| Intent embeddings | `paraphrase-multilingual-MiniLM-L12-v2` | Handles Devanagari, Hinglish and English in one space |
| Intent classifier base | `google/muril-base-cased` | Trained on 17 Indian languages including transliterated Hinglish |

Swap any of them with an environment variable, or switch profile wholesale:

```bash
MODEL_PROFILE=quality ./run.sh     # whisper-hindi-medium + IndicF5 + IndicTrans2-1B
TTS_MODEL=ai4bharat/IndicF5 ./run.sh
```

`IndicF5` gives noticeably better prosody but is a voice-cloning model: it needs
a reference clip at `backend/assets/ref_audio/hindi_ref.wav` plus that clip's
exact transcript in `INDICF5_REF_TEXT`. It also needs `pip install f5-tts`.

**On IndicTrans2**: it is the better en→hi model and was the original default,
but its `trust_remote_code` imports `transformers.onnx`, which transformers v5
removed — so it cannot load there at all, regardless of access. It is also a
gated repo. To use it anyway, pin `transformers<5`, accept the terms on the Hub,
and set `HF_TOKEN` plus:

```bash
pip install IndicTransToolkit
export TRANSLATE_MODEL=ai4bharat/indictrans2-en-indic-dist-200M
```

Translation only affects manager-authored task text, and `seed/tasks_hi.json`
carries curated Hindi for every seeded task, so none of this blocks a demo.

---

## The intent layer

35 intents across six domains, defined in one file
(`backend/app/ai/intent/taxonomy.py`) that feeds three consumers: the keyword
matcher, the embedding prototype bank, and the supervised training set.

**Machine context is a hard filter.** Each machine declares the intents it can
answer. Ask the wheel loader about hydraulic oil temperature and it does not
guess or fall back to a generic reply — it says that sensor does not exist on
this machine, and suggests what you can ask instead.

Training the classifier:

```bash
python -m app.ai.intent.build_dataset   # 263 seed phrases -> ~1800 labelled rows
python -m app.ai.intent.train           # fine-tunes MuRIL, writes models/intent-classifier/
```

The dataset builder expands each seed phrase with politeness wrappers, code
mixing, truncation and simulated ASR corruption, and adds out-of-scope chatter
labelled `UNKNOWN` so the model learns to refuse. The API picks the checkpoint up
automatically; until it exists the router simply skips stage L3.

Measuring it:

```bash
python -m app.ai.intent.evaluate              # full cascade
python -m app.ai.intent.evaluate --stage rules  # keyword layer alone
```

---

## What the backend actually computes

None of these use a language model.

- **Task time estimation** — similarity-weighted kNN over 420 completed jobs,
  predicting minutes-per-unit from weather, ground, shift, ambient temperature
  and operator skill. Returns a range, a confidence, and the named factors that
  moved the estimate, because "2 hours 20 minutes, and the rocky ground adds 6%"
  is a useful answer where a bare number is not.
- **Anomaly detection** — each machine's own telemetry history is the baseline.
  Detects excessive idling (with the litres and rupees it wasted), seatbelt
  violation patterns, thermal excursions, low cycle rate, fuel-burn outliers by
  z-score, overdue service and live proximity breaches. Every finding carries its
  evidence and a recommendation.
- **Safety** — seatbelt compliance, proximity events, incident logging with the
  telemetry snapshot captured at the time, rolled into one score.
- **Response generation** — bilingual templates, not generation. A template
  cannot hallucinate a fuel level, its Hindi is grammatical every time, and it
  renders in microseconds. Each reply also carries a separate `speech` string,
  because TTS reads "%" and "°C" badly.

---

## Layout

```
backend/
  app/
    ai/
      intent/      taxonomy, normaliser, rules, embeddings, classifier, router, training
      stt.py  tts.py  translate.py  embeddings.py  registry.py
    services/      telemetry, anomaly, estimator, safety, nlg, tasks, assistant, site
    routers/       auth, tasks, machines, assistant, voice, safety, training, system
    seed/          machines, operators, tasks, 420 task records, 810 telemetry rows
  scripts/         download_models.py, generate_history.py
frontend/
  src/pages/       Login, Shift, MachineSelect, Cockpit, Training, Insights
  src/components/  Assistant, MicButton, Chrome, MachineIcon, ui
  src/lib/         api, i18n, audio, useVoice, useSpeech, session
```

The UI runs fully in Hindi or English — every string, every API reply, switchable
at any moment from the header.

---

## Demo flow

1. **Login** → `OP1001 / cat1234`
2. **Shift** → three tasks the manager wrote in English, shown and read aloud in
   Hindi. Press the speaker to hear the full briefing.
3. **Machines** → pick by tapping, or hold the mic and say *"लोडर चुनो"*.
4. **Cockpit** → live telemetry, health score, safety panel, current task ETA.
   Ask by voice: *"कितना ईंधन बचा है"*, *"मशीन में कोई खराबी है क्या"*,
   *"यह काम कितनी देर में पूरा होगा"*. Expand the badge under any answer to see
   which stage answered it and how long each took.
5. **Switch machine** → ask the same fuel question on the loader (different
   numbers), then ask about hydraulic temperature (politely refused — no such
   sensor).
6. **Insights** → the share of questions resolved at each stage, average routing
   time, and an LLM call count of zero.

See `docs/DEMO.md` for the script with the exact Hindi phrasings.
