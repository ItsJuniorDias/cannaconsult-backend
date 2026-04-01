// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middlewares
app.use(cors());
app.use(express.json());

app.post("/api/checkout/pix", async (req, res) => {
  try {
    const result = await createPixOrder(req.body.customer, req.body.items);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Falha no checkout" });
  }
});

app.post("/api/checkout/cartao", async (req, res) => {
  try {
    // 1. Recebemos os dados enviados pelo frontend no corpo da requisição
    const { customer, items, cardToken, installments } = req.body;

    // 2. Validação básica de segurança
    if (!cardToken) {
      return res
        .status(400)
        .json({ error: "O token do cartão é obrigatório." });
    }
    if (!customer || !items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Dados do cliente ou itens do carrinho inválidos." });
    }

    // 3. Chamamos o serviço que se comunica com o Pagar.me
    // (A função createCreditCardOrder foi definida no exemplo anterior)
    const result = await createCreditCardOrder(
      customer,
      items,
      cardToken,
      installments || 1, // Padrão: 1 parcela (à vista) se não for enviado
    );

    // 4. Verificamos o status do pagamento retornado pelo Pagar.me
    if (result.status === "failed") {
      // Se o cartão for recusado (falta de limite, bloqueio, etc.)
      return res.status(402).json({
        success: false,
        message: "Pagamento recusado pelo banco emissor.",
        orderId: result.orderId,
      });
    }

    // 5. Sucesso! Retornamos os dados da transação para o frontend
    return res.status(200).json({
      success: true,
      message: "Pagamento aprovado com sucesso!",
      orderId: result.orderId,
      status: result.status,
    });
  } catch (error) {
    console.error("Erro na rota de cartão de crédito:", error);

    // Tratamento de erro genérico para o frontend
    return res.status(500).json({
      success: false,
      error: "Ocorreu um erro interno ao processar seu pagamento.",
    });
  }
});

// Rota para criar a Sessão de Checkout
app.post("/api/checkout_sessions", async (req, res) => {
  async function ativarPixContaConectada() {
    try {
      const account = await stripe.accounts.update("acct_1TH3A7IKuiZX6Fzd", {
        capabilities: {
          pix_payments: { requested: true },
        },
      });
      console.log("Solicitação de PIX enviada com sucesso:", account.id);
    } catch (error) {
      console.error("Erro ao atualizar conta:", error.message);
    }
  }

  ativarPixContaConectada();

  try {
    // Recebe o ID do preço criado no Stripe Dashboard
    const { priceId } = req.body;

    // Validação básica de segurança
    if (!priceId) {
      return res.status(400).json({ error: "O priceId é obrigatório." });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment", // ATENÇÃO: Se o seu priceId for de uma assinatura, mude de "payment" para "subscription"

      // Passando o priceId diretamente
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      // URLs de redirecionamento após o pagamento ou cancelamento
      success_url: `${process.env.CLIENT_URL}/chat`,
      cancel_url: `${process.env.CLIENT_URL}/paywall`,
    });

    // Retorna a URL do Stripe Checkout para o front-end
    res.json({ url: session.url });
  } catch (error) {
    console.error("Erro ao criar sessão no Stripe:", error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciando o servidor
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
