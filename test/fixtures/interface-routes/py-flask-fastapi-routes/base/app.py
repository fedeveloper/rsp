from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/items")
def list_items():
    return jsonify([])


@app.route("/items/<int:item_id>", methods=["GET", "DELETE"])
def item(item_id):
    return jsonify({})


@app.post("/items")
def create_item():
    return jsonify({}), 201


@app.get("/health")
def health():
    return "ok"


HELP = """
@app.get("/old-docs")
"""
