"""Assistant orchestration: utterance in, machine-aware answer out.

This is the seam the whole product turns on. The router decides *what* was
asked, this decides *which machine's* data answers it, and the response
generator turns that into Hindi and English. Nothing here talks to a large
language model.
"""

from __future__ import annotations

import time
from datetime import datetime

from .. import db
from ..ai.intent.router import route
from . import nlg, tasks as task_service


def supported_intents(machine_id: str) -> set[str]:
    machine = db.machine(machine_id)
    return set(machine.get("supported_intents", [])) if machine else set()


def ask(
    *,
    operator_id: str,
    machine_id: str,
    text: str | None = None,
    intent: str | None = None,
    language: str = "hi",
    source: str = "text",
) -> dict:
    """Answer one question in the context of one machine."""
    started = time.perf_counter()
    machine = db.machine(machine_id)
    if machine is None:
        raise KeyError(machine_id)

    routed = route(
        text or "",
        supported_intents=supported_intents(machine_id),
        forced_intent=intent,
    )

    # A switch-machine request retargets the whole answer at the new machine, so
    # the follow-up question already lands on the right telemetry.
    switched_to = None
    if routed.intent == "SWITCH_MACHINE" and routed.slots.get("machine"):
        target = next((m for m in db.MACHINES if m["family"] == routed.slots["machine"]), None)
        if target and target["id"] != machine_id:
            switched_to = target["id"]
            db.set_session(operator_id, target["id"])

    reply = nlg.build(
        routed.intent,
        machine_id=machine_id,
        operator_id=operator_id,
        slots=routed.slots,
        alternatives=[{"intent": i, "score": s} for i, s in routed.alternatives],
        unsupported=routed.unsupported_on_machine,
        task_hi=task_service.hindi_map(operator_id),
    )

    record = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "source": source,
        "language": language,
        "machine_id": switched_to or machine_id,
        "text": text or "",
        "intent": routed.intent,
        "stage": routed.stage,
        "confidence": round(routed.confidence, 4),
        "unsupported": routed.unsupported_on_machine,
        "reply_hi": reply["text"]["hi"],
        "reply_en": reply["text"]["en"],
        "route_ms": round(routed.total_ms, 2),
    }
    db.log_turn(operator_id, record)

    return {
        "machine_id": switched_to or machine_id,
        "switched_machine": switched_to,
        "route": routed.as_dict(),
        "reply": reply,
        "language": language,
        "total_ms": round((time.perf_counter() - started) * 1000, 2),
        "at": record["at"],
    }


def suggestions(machine_id: str, operator_id: str) -> list[dict]:
    """The quick-question chips for this machine, as intent-tagged buttons.

    Each chip carries its intent, so tapping one skips classification entirely -
    stage L0 of the router. The same question asked by voice goes through the
    full cascade, which is exactly the contrast the demo is meant to show.
    """
    machine = db.machine(machine_id)
    if machine is None:
        return []

    from ..ai.intent import rules

    out: list[dict] = []
    hindi = machine.get("quick_questions_hi", [])
    english = machine.get("quick_questions_en", [])
    for index, question_hi in enumerate(hindi):
        hit = rules.best(question_hi, allowed=supported_intents(machine_id))
        out.append(
            {
                "id": f"q{index}",
                "intent": hit.intent if hit else "HELP",
                "label_hi": question_hi,
                "label_en": english[index] if index < len(english) else question_hi,
            }
        )
    return out


def history(operator_id: str, limit: int = 30) -> list[dict]:
    return db.conversation(operator_id, limit)


def analytics() -> dict:
    """Where answers came from - the number that justifies the architecture."""
    log = db.ROUTER_LOG
    if not log:
        return {"turns": 0, "by_stage": {}, "by_intent": {}, "avg_route_ms": 0.0,
                "llm_calls": 0, "resolved_locally_pct": 100.0}

    by_stage: dict[str, int] = {}
    by_intent: dict[str, int] = {}
    for row in log:
        by_stage[row["stage"]] = by_stage.get(row["stage"], 0) + 1
        by_intent[row["intent"]] = by_intent.get(row["intent"], 0) + 1

    resolved = sum(count for stage, count in by_stage.items() if stage != "fallback")
    return {
        "turns": len(log),
        "by_stage": by_stage,
        "by_intent": dict(sorted(by_intent.items(), key=lambda kv: kv[1], reverse=True)),
        "avg_route_ms": round(sum(r["route_ms"] for r in log) / len(log), 2),
        "llm_calls": 0,
        "resolved_locally_pct": round(resolved / len(log) * 100, 1),
    }
