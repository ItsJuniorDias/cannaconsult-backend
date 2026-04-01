// pagarmeClient.js
const axios = require("axios");

const PAGARME_SECRET_KEY = "sk_0fa797a4c33d4c82be0b3772b577acea"; // Use variáveis de ambiente na vida real (process.env)
const encodedKey = Buffer.from(`${PAGARME_SECRET_KEY}:`).toString("base64");

const api = axios.create({
  baseURL: "https://api.pagar.me/core/v5",
  headers: {
    Authorization: `Basic ${encodedKey}`,
    "Content-Type": "application/json",
  },
});

module.exports = api;
