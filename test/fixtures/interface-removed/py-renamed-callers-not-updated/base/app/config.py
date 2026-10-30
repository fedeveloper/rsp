import os

DEFAULTS = {"timeout": 10}


def load_settings():
    return {**DEFAULTS, "key": os.environ.get("API_KEY")}
