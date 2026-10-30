const express = require("express");

const app = express();
const router = express.Router();

app.get("/items/:id", (req, res) => res.json({}));
app.post("/items/:id/delete", (req, res) => res.sendStatus(204));
router.post("/orders", (req, res) => res.sendStatus(201));

module.exports = { app, router };
