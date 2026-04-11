// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");

const { plainAddPlaceholder } = require("@signpdf/placeholder-plain");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const SIGNATURE_LENGTH = 8192;
const app = express();

app.use(cors());
app.use(express.json());

app.post("/api/gerar-hash-pdf", async (req, res) => {
  try {
    const { pdfLaudo, pdfReceita, motivo } = req.body;

    if (!pdfLaudo || !pdfReceita || !motivo) {
      return res
        .status(400)
        .json({ error: "pdfLaudo, pdfReceita e motivo são obrigatórios." });
    }

    // 1. Gerar o hash do PDF usando SHA-256
    const hashLaudo = crypto
      .createHash("sha256")
      .update(Buffer.from(pdfLaudo, "base64"))
      .digest("hex");

    const hashReceita = crypto
      .createHash("sha256")
      .update(Buffer.from(pdfReceita, "base64"))
      .digest("hex");

    console.log("Hash do Laudo:", hashLaudo);
    console.log("Hash da Receita:", hashReceita);

    // 2. Retornar os hashes e o motivo para o frontend
    return res.status(200).json({
      success: true,
      hashLaudo,
      hashReceita,
      motivo,
    });
  } catch (error) {
    console.error("Erro ao gerar hash do PDF:", error.message);
    return res.status(500).json({
      error: "Erro interno ao processar o PDF.",
    });
  }
});

// ============================================================================
// ENDPOINT PARA BUSCAR O CREDENTIAL ID PELO CPF
// ============================================================================
app.post("/api/buscar-certificado", async (req, res) => {
  try {
    const { cpf } = req.body;

    if (!cpf) {
      return res.status(400).json({ error: "O CPF é obrigatório." });
    }

    // 2. Obter token de acesso do Soluti/BirdID e aos certificados do usuário (CPF) usando client_credentials
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "client_credentials");
    tokenParams.append("client_id", process.env.SOLUTI_CLIENT_ID);
    tokenParams.append("client_secret", process.env.SOLUTI_CLIENT_SECRET);

    const authResponse = await axios.post(
      "https://api.birdid.com.br/oauth/token",
      tokenParams,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const accessToken = authResponse.data.access_token;

    // 3. Consultar a lista de credenciais usando o CPF como userID
    const listResponse = await axios.get(
      `https://api.birdid.com.br/v0/oauth/certificate-discovery`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`, // O token que você acabou de gerar
        },
      },
    );

    const credentialIDs = listResponse.data;

    console.log("Credenciais encontradas para o CPF:", credentialIDs);

    // // Se o array vier vazio ou não existir, o médico não tem BirdID ativo
    // if (!credentialIDs || credentialIDs.length === 0) {
    //   return res.status(404).json({
    //     error: "Nenhum certificado BirdID ativo encontrado para este CPF.",
    //   });
    // }

    // 4. Retorna o ID da credencial (geralmente pegamos a primeira [0])
    return res.status(200).json({
      success: true,
      credentialId: "JOAO MARCOS SANTOS DA SILVA:02331822255",
      accessToken,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar credencial:",
      error.response?.data || error.message,
    );
    return res.status(500).json({
      error: "Erro interno ao tentar localizar o certificado na Soluti.",
    });
  }
});

// ============================================================================
// FUNÇÃO AUXILIAR: VALIDAÇÃO DO RECAPTCHA
// ============================================================================
async function verificarCaptcha(token) {
  if (!token) return false;
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      null,
      { params: { secret: secretKey, response: token } },
    );
    return response.data.success;
  } catch (error) {
    console.error("Erro ao validar reCAPTCHA:", error.message);
    return false;
  }
}

// ============================================================================
// ENDPOINTS DE CHECKOUT
// ============================================================================

app.post("/api/checkout/pix", async (req, res) => {
  try {
    const { customer, items, captchaToken } = req.body;
    if (!customer || !items || items.length === 0) {
      return res.status(400).json({ error: "Dados inválidos." });
    }
    const isHuman = await verificarCaptcha(captchaToken);
    if (!isHuman) return res.status(403).json({ error: "Falha de segurança." });

    const result = await createPixOrder(customer, items);
    res.json(result);
  } catch (error) {
    console.error("Erro no checkout PIX:", error);
    res.status(500).json({ error: "Falha no checkout PIX." });
  }
});

app.post("/api/checkout/cartao", async (req, res) => {
  try {
    const { customer, items, cardToken, installments, captchaToken } = req.body;
    if (!cardToken || !customer || !items || items.length === 0) {
      return res.status(400).json({ error: "Dados inválidos." });
    }
    const isHuman = await verificarCaptcha(captchaToken);
    if (!isHuman) return res.status(403).json({ error: "Falha de segurança." });

    const result = await createCreditCardOrder(
      customer,
      items,
      cardToken,
      installments || 1,
    );

    if (result.status === "failed") {
      return res.status(402).json({
        success: false,
        message: "Recusado pelo emissor.",
        orderId: result.orderId,
      });
    }
    return res.status(200).json({
      success: true,
      message: "Aprovado!",
      orderId: result.orderId,
      status: result.status,
    });
  } catch (error) {
    console.error("Erro na rota cartão:", error);
    return res.status(500).json({ success: false, error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
