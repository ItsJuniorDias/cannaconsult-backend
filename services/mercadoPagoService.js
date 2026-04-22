// services/mercadoPagoClient.js
const { MercadoPagoConfig } = require("mercadopago");

// Lembre-se de colocar o seu Access Token no arquivo .env
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

// Inicializa a configuração do cliente
const client = new MercadoPagoConfig({
  accessToken: MERCADOPAGO_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

module.exports = client;
