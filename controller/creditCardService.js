// creditCardService.js
const { Payment } = require("mercadopago");
const client = require("../services/mercadoPagoService");

async function createCreditCardOrder(
  customerData,
  itemsData,
  cardToken,
  installments = 1,
) {
  try {
    const payment = new Payment(client);

    // 1. Cálculo do Valor Total (Mesma lógica usada no PIX)
    const totalAmount = itemsData.reduce((acc, item) => {
      const precoItem = (item.amount || item.price) / 100;
      return acc + precoItem * (item.quantity || 1);
    }, 0);

    // 2. Montagem do Payload do Mercado Pago
    const payload = {
      body: {
        transaction_amount: totalAmount,
        token: cardToken, // O token gerado pelo SDK do frontend (MercadoPago.js)
        description: "Consulta Canna Consult",
        installments: Number(installments),

        // IMPORTANTE: O Mercado Pago exige o email no pagamento via cartão
        payer: {
          email: customerData.email,
          identification: {
            type: "CPF",
            number: customerData.document?.replace(/\D/g, "") || "00000000000",
          },
        },
        statement_descriptor: "CANNACONSULT", // Nome na fatura do cartão
      },
    };

    // 3. Executa a requisição
    const response = await payment.create(payload);

    console.log("Status do Pagamento no MP:", response.status); // ex: 'approved', 'rejected', 'in_process'

    // 4. Mapeamento de Status
    // O seu server.js espera que retorne 'failed' para pagamentos recusados.
    // O Mercado Pago retorna 'rejected'. Vamos traduzir isso para o seu sistema:
    let mappedStatus = response.status;
    if (response.status === "rejected") {
      mappedStatus = "failed";
    } else if (response.status === "approved") {
      mappedStatus = "paid";
    }

    // 5. Retorna no mesmo formato que o seu frontend já consome
    return {
      orderId: response.id.toString(),
      status: mappedStatus,
      // No Mercado Pago, a "order" e a "charge" são a mesma coisa neste contexto simples
      chargeId: response.id.toString(),
    };
  } catch (error) {
    console.error(
      "Erro ao processar Cartão no Mercado Pago:",
      error.message || error,
    );
    throw error;
  }
}

module.exports = {
  createCreditCardOrder,
};
