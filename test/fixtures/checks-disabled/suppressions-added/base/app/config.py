import os


def load():
    return {"debug": os.getenv("DEBUG") == "1"}
