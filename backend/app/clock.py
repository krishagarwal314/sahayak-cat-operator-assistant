"""The app's one clock.

For the offline demo, DEMO_TIME freezes it (e.g. 2026-09-24T14:30:00): every
live reading, and so every spoken answer, is then the same on every run, which
is what lets all the voice clips be recorded in advance.
"""

from __future__ import annotations

from datetime import datetime

from .config import settings


def now() -> datetime:
    if settings.demo_time:
        return datetime.fromisoformat(settings.demo_time)
    return datetime.now()
