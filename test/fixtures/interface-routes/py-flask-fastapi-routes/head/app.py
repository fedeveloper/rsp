from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/items")
def list_items():
    return jsonify([])


@app.route("/items/<item_id>", methods=["GET"])
def item(item_id):
    return jsonify({})


HELP = """
"""
