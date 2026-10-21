import os

DEBUG = False
STRIPE_KEY = os.getenv("STRIPE_KEY")
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost")
