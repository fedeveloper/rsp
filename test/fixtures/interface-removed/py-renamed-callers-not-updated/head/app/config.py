import os

DEFAULTS = {"timeout": 10}


def read_settings():
    return {**DEFAULTS, "key": os.environ.get("API_KEY")}
