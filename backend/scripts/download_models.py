"""Download every model the assistant uses, ahead of the demo.

    python scripts/download_models.py                  # the balanced profile
    python scripts/download_models.py --profile lite    # smallest footprint
    python scripts/download_models.py --profile quality # best quality
    python scripts/download_models.py --only stt tts    # just these

Nothing here is trained - these are all pulled from the Hub. The one model this
project trains itself is the intent classifier:

    python -m app.ai.intent.build_dataset
    python -m app.ai.intent.train
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import PROFILES  # noqa: E402

# Approximate on-disk size, so you know what you are committing to on hotel wifi.
SIZES = {
    "openai/whisper-small": "0.9 GB",
    "vasista22/whisper-hindi-small": "0.9 GB",
    "vasista22/whisper-hindi-medium": "3.1 GB",
    "facebook/mms-tts-hin": "0.15 GB",
    "facebook/mms-tts-eng": "0.15 GB",
    "kakao-enterprise/vits-ljs": "0.15 GB",
    "ai4bharat/IndicF5": "1.4 GB",
    "facebook/nllb-200-distilled-600M": "2.5 GB",
    "facebook/nllb-200-distilled-1.3B": "5.5 GB",
    "ai4bharat/indictrans2-en-indic-dist-200M": "0.9 GB",
    "ai4bharat/indictrans2-en-indic-1B": "4.5 GB",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": "0.5 GB",
    "intfloat/multilingual-e5-base": "1.1 GB",
    "ai4bharat/indic-bert": "0.14 GB",
    "google/muril-base-cased": "0.95 GB",
}

# Repos that require accepting terms on the Hub before they can be downloaded.
# Approval is normally instant, but it does need an account and a token.
# Note these are no longer in any default profile: IndicTrans2 cannot load on
# transformers v5 regardless of access. See app/config.py.
GATED = {
    "ai4bharat/indictrans2-en-indic-dist-200M",
    "ai4bharat/indictrans2-en-indic-1B",
}

ROLE_NOTES = {
    "stt": "speech to text (Hindi)",
    "tts": "text to speech (Hindi)",
    "tts_en": "text to speech (English)",
    "translate": "English -> Hindi for manager task text",
    "embedder": "semantic intent matching (router stage L2)",
    "intent_base": "base checkpoint the intent classifier is fine-tuned from",
}


def _download(repo_id: str, role: str) -> bool:
    from huggingface_hub import snapshot_download

    size = SIZES.get(repo_id, "unknown size")
    print(f"\n[{role}] {repo_id}  ({size})")
    print(f"        {ROLE_NOTES.get(role, '')}")
    started = time.perf_counter()
    try:
        path = snapshot_download(
            repo_id=repo_id,
            # Skip duplicate weight formats; transformers prefers safetensors.
            ignore_patterns=["*.msgpack", "*.h5", "*.ot", "*.tflite", "training_args.bin"],
        )
    except Exception as exc:  # noqa: BLE001
        print(f"        FAILED: {type(exc).__name__}: {exc}")
        if repo_id in GATED or "gated" in str(exc).lower() or "401" in str(exc):
            print(f"        This repo is gated. Accept the terms at")
            print(f"          https://huggingface.co/{repo_id}")
            print(f"        then create a read token and export it:")
            print(f"          export HF_TOKEN=hf_...")
            print(f"        Or use an ungated model instead:")
            print(f"          export TRANSLATE_MODEL=facebook/nllb-200-distilled-600M")
        return False
    print(f"        done in {time.perf_counter() - started:.0f}s -> {path}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", default="balanced", choices=sorted(PROFILES))
    parser.add_argument("--only", nargs="*", choices=sorted(ROLE_NOTES),
                        help="download only these roles")
    parser.add_argument("--list", action="store_true", help="show the plan and exit")
    args = parser.parse_args()

    plan = PROFILES[args.profile]
    roles = args.only or list(plan)

    print(f"profile: {args.profile}")
    for role in roles:
        print(f"  {role:11s} {plan[role]:58s} {SIZES.get(plan[role], '?')}")
    if args.list:
        return

    print("\nIndicF5 also needs `pip install f5-tts`, and IndicTrans2 needs "
          "`pip install IndicTransToolkit`.")
    gated = [plan[r] for r in roles if plan[r] in GATED]
    if gated and not (os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")):
        print("\nNOTE: this profile includes a gated repo and HF_TOKEN is not set:")
        for repo in gated:
            print(f"  https://huggingface.co/{repo}  <- accept the terms there first")
        print("  then: export HF_TOKEN=hf_...")
    print()

    ok = failed = 0
    for role in roles:
        if _download(plan[role], role):
            ok += 1
        else:
            failed += 1

    print(f"\n{ok} downloaded, {failed} failed")
    if failed:
        print("The app still runs without them - missing models degrade, they do not crash.")
        sys.exit(1)
    print("\nNext:")
    print("  python -m app.ai.intent.build_dataset")
    print("  python -m app.ai.intent.train")
    print("  uvicorn app.main:app --port 8000")


if __name__ == "__main__":
    main()
