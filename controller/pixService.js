// pixService.js
const api = require("../services/pagarmeClient");

async function createPixOrder(customerData, itemsData) {
  try {
    const payload = {
      items: itemsData,
      customer: customerData,
      payments: [
        {
          payment_method: "pix",
          pix: {
            expires_in: 3600, // Tempo de expiração em segundos (1 hora)
          },
        },
      ],
    };

    const response = await api.post("/orders", payload);

    console.log("Resposta do Pagar.me:", response.data); // Log para depuração

    // O retorno conterá o QR Code e o link para copiar e colar
    const pixData = response.data.charges[0].last_transaction;

    console.log("Resposta do Pagar.me:", pixData); // Log para depuração

    return {
      orderId: response.data.id,
      qrCodeUrl: pixData.qr_code_url,
      qrCode: pixData.qr_code, // Texto do "Copia e Cola"
    };
  } catch (error) {
    console.error(
      "Erro ao gerar PIX:",
      error.response ? error.response.data : error.message,
    );
    throw error;
  }
}

module.exports = {
  createPixOrder,
};
