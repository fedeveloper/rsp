from app.config import (
    DEFAULTS,
    load_settings,
)


def run():
    return load_settings(), DEFAULTS
