const { Payment } = require("mercadopago");
// Importa o cliente do Mercado Pago que criamos na etapa anterior
const client = require("../services/mercadoPagoService");

async function createPixOrder(customerData, itemsData) {
  try {
    const payment = new Payment(client);

    // 1. Cálculo do Valor Total
    // O Mercado Pago usa decimais (ex: 10.50) e não centavos como o Pagar.me.
    // Se o seu frontend manda em centavos, dividimos por 100 aqui.
    const totalAmount = itemsData.reduce((acc, item) => {
      // Ajuste essa lógica dependendo de como o item chega (ex: item.price ou item.amount)
      const precoItem = (item.amount || item.price) / 100;
      return acc + precoItem * (item.quantity || 1);
    }, 0);

    // 2. Tempo de Expiração (1 hora)
    // O Pagar.me aceita segundos, o Mercado Pago exige uma data ISO 8601
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + 1);

    // 3. Montagem do Payload do Mercado Pago
    const payload = {
      body: {
        transaction_amount: totalAmount,
        description: "Pedido na Canna Consult", // Modifique para a descrição que preferir
        payment_method_id: "pix",
        payer: {
          email: customerData.email,
          first_name: customerData.name?.split(" ")[0] || "Cliente", // Extrai apenas o primeiro nome
          identification: {
            type: "CPF", // Pode ser dinâmico se aceitar CNPJ
            // O MP exige CPF limpo (apenas números). Substitua pela variável correta que vem do seu front
            number: customerData.document?.replace(/\D/g, "") || "00000000000",
          },
        },
        date_of_expiration: expirationDate.toISOString(),
      },
    };

    // 4. Executa a requisição de pagamento
    const response = await payment.create(payload);

    console.log("Resposta do Mercado Pago:", response.id); // Log para depuração

    const transactionData = response.point_of_interaction.transaction_data;

    // 5. Retorna no MESMO formato que seu frontend já espera do Pagar.me
    return {
      orderId: response.id.toString(),
      // O MP retorna a imagem do QRCode em Base64 nativamente. Já montamos a tag para exibir na tela.
      qrCodeUrl: `data:image/jpeg;base64,${transactionData.qr_code_base64}`,
      qrCode: transactionData.qr_code, // Texto do "Copia e Cola"
    };
  } catch (error) {
    console.error("Erro ao gerar PIX no Mercado Pago:", error.message || error);
    throw error;
  }
}

module.exports = {
  createPixOrder,
};
