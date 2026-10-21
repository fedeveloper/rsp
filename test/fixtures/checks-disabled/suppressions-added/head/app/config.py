import os
import json  # noqa: F401


def load():
    timeout: int = os.getenv("TIMEOUT", 30)  # type: ignore
    if os.getenv("DEBUG") == "1":  # pragma: no cover
        return {"debug": True, "timeout": timeout}
    return {"debug": False, "timeout": timeout}
