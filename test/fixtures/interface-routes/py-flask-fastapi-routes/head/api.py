from app import app
from flask import jsonify


@app.post("/items")
def create_item():
    return jsonify({}), 201
