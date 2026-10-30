try:
    from app.config import load_settings
except ImportError:
    load_settings = None
