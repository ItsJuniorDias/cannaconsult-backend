// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middlewares
app.use(cors());
app.use(express.json());

// Rota para criar a Sessão de Checkout
app.post("/api/checkout_sessions", async (req, res) => {
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
