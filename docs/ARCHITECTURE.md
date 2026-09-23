# Architecture

## The decision this project is built around

The obvious way to build an operator assistant is to put every question through
a large language model with the telemetry in the prompt. That works, and it is
wrong for this problem:

- **Latency.** A cab question needs an answer now, not in two seconds.
- **Cost.** Per-question cost multiplied by a fleet, for a shift, every day.
- **Trust.** A generated answer about a fuel level can be wrong in a way that is
  indistinguishable from being right.
- **Connectivity.** Pits have poor connectivity. A cloud round trip is a
  liability.
- **Validation.** You cannot certify "the model usually says the right thing"
  for a safety-adjacent system.

So the architecture is inverted. Structured machine data and predefined
instructions do the work; intelligence is spent only where it is genuinely
needed, which is understanding *what the operator asked*. That is a
classification problem over a bounded space, and a classification problem is
small, fast, testable, and ours to train.

## The router

```
utterance
   │
   ▼  normalise      Devanagari digits, nukta folding, ASR fixes, filler removal,
   │                 Hinglish-aware tokenisation
   ├─ L0 quick action   the UI supplied the intent — nothing to classify
   ├─ L1 rules          token keyword match over the taxonomy         <1 ms
   ├─ L2 embeddings     cosine kNN over a prototype bank             ~15 ms
   ├─ L3 classifier     fine-tuned MuRIL head                        ~25 ms
   └─ L4 clarify        offer the best guesses as chips
   │
   ▼  machine filter   intent not on this machine -> explicit refusal
   ▼  response         bilingual template + speech-shaped variant
```

Stage L1 accepts only on a clear margin over the runner-up; a near tie is passed
to L2 so that meaning, not keyword length, breaks it. L2 blends the single
nearest neighbour with the intent centroid — the max term catches a paraphrase of
one specific phrasing, the centroid term stops one odd example dragging an intent
in. L3 exists so the system improves with real operator recordings without any
architectural change.

Every stage records a trace step, and the trace is returned to the client. That
is what the UI renders under each answer.

## Why keywords first, and why they survive

A keyword layer is unfashionable, but for a bounded domain with a fixed
vocabulary it is the right tool: it is exact, it is explainable, it costs
nothing, and a site engineer can extend it without retraining anything. The
interesting engineering is in making it work for Hindi rather than English:

- keyword phrases match as **token subsets**, not substrings, because Hindi puts
  particles between words English keeps adjacent (`इंजन कितना गरम है`)
- matching is **prefix-tolerant**, because Hindi inflects by suffix
  (`चल` / `चली` / `चलता`)
- **keywords pass through the same normaliser as the utterance**, so a keyword
  written `ऑयल प्रेशर` still matches after the normaliser rewrites `प्रेशर`
- **anti-keywords** separate intents that share vocabulary
  (`TASK_TODAY` vs `TASK_NEXT`, `TASK_TIME_ESTIMATE` vs `IDLE_TIME`)
- scoring is clipped **before** penalties, so an anti-keyword actually bites

## Machine context

Each machine profile in `seed/machines.json` declares its sensors, its thresholds
and the intents it supports. The router takes that set as a hard filter. The
result is that the same interface behaves differently per machine without a
separate assistant per machine — and an unsupported question produces an honest
refusal instead of a plausible fabrication.

Adding a fourth machine is a JSON file. No code, no retraining.

## Where a language model would earn its place

Not in the request path, but:

- mining free-text incident reports for recurring hazards
- drafting new taxonomy phrasings from logged `UNKNOWN` utterances, for a human
  to approve
- open-ended coaching on the training hub, where latency and determinism matter
  much less

The `UNKNOWN` bucket and the router log are deliberately shaped to feed that
loop.

## Known limits

- Telemetry is simulated. The seam is `services/telemetry.py`; a real feed
  replaces that one module and nothing above it changes.
- The classifier's training data is synthesised from seed phrases. It will get
  materially better on real cab recordings, which is the main thing this needs
  next.
- The evaluation set is hand-written, and the keyword lists were widened in
  response to its failures — treat the score as a regression suite, not as an
  unbiased measurement.
- Hindi only in this build. Every other language is a taxonomy translation plus
  a TTS voice; the router, the machine profiles and the templates are unchanged.
