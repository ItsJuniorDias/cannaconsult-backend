// creditCardService.js
const api = require("../services/pagarmeClient");

async function createCreditCardOrder(
  customerData,
  itemsData,
  cardToken,
  installments = 1,
) {
  try {
    const payload = {
      items: itemsData,
      customer: customerData,
      payments: [
        {
          payment_method: "credit_card",
          credit_card: {
            installments: installments,
            statement_descriptor: "SUA LOJA", // Nome que aparece na fatura (máx 13 chars)
            card: {
              // Em vez de passar number, cvv, etc., passamos o token gerado no front
              token: cardToken,
            },
          },
        },
      ],
    };

    const response = await api.post("/orders", payload);

    return {
      orderId: response.data.id,
      status: response.data.status, // 'paid', 'failed', etc.
      chargeId: response.data.charges[0].id,
    };
  } catch (error) {
    console.error(
      "Erro ao processar Cartão:",
      error.response ? error.response.data : error.message,
    );
    throw error;
  }
}

module.exports = {
  createCreditCardOrder,
};
