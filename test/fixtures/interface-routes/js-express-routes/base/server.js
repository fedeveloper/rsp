const express = require("express");

const app = express();
const router = express.Router();

app.get("/items/:sku", (req, res) => res.json({}));
app.delete("/items/:sku", (req, res) => res.sendStatus(204));
router.post("/orders", (req, res) => res.sendStatus(201));
app.get("/legacy", (req, res) => res.redirect("/items"));

module.exports = { app, router };
