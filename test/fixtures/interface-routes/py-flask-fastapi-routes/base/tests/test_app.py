from app import app


@app.get("/test-only")
def probe():
    return "x"
