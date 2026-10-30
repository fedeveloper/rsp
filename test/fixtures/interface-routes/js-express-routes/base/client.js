const axios = require("axios");

exports.remote = () => axios.get("/remote", { timeout: 5 });
