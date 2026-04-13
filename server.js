// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const axios = require("axios");

const SolutiService = require("./services/solutiService");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const app = express();

app.use(cors());
app.use(express.json());

// Rota 1: Gerar URL (Apenas para referência, no front você gerou a URL direto no botão)
app.get("/api/auth-url", (req, res) => {
  const url = `${process.env.SOLUTI_OAUTH_URL}/authorize?client_id=${process.env.SOLUTI_CLIENT_ID}&redirect_uri=${process.env.SOLUTI_REDIRECT_URI}&response_type=code&scope=signature`;
  res.json({ url });
});

// ============================================================================
// ROTAS DO BIRD ID (SOLUTI)
// ============================================================================

// 1. Rota para trocar o Authorization Code pelo Access Token
app.post("/api/auth/birdid/callback", async (req, res) => {
  // 1. Recebe também o code_verifier do frontend
  const { code, code_verifier } = req.body;

  // 2. Valida se ambos foram enviados
  if (!code) {
    return res.status(400).json({ error: "Código de autorização ausente." });
  }
  if (!code_verifier) {
    return res
      .status(400)
      .json({ error: "Parâmetro PKCE (code_verifier) ausente." });
  }

  try {
    // 3. Passa o code E o code_verifier para o seu serviço
    const tokenResponse = await SolutiService.getAccessToken(
      code,
      code_verifier,
    );

    // IMPORTANTE: Se o seu SolutiService retorna o JSON inteiro da Soluti, pegue o access_token.
    // Se ele já retorna a string, use apenas `tokenResponse`.
    const accessToken =
      typeof tokenResponse === "string"
        ? tokenResponse
        : tokenResponse.access_token;

    console.log("Access Token recebido com sucesso!");

    // Devolve para o Frontend salvar no LocalStorage
    res.json({ access_token: accessToken });
  } catch (error) {
    console.error("Erro ao gerar token BirdID:", error);
    res
      .status(500)
      .json({ error: error.message || "Falha interna ao gerar token" });
  }
});

/**
 * Rota para validação do Passo 1: Geração de Token
 */
app.post("/api/sign", async (req, res) => {
  const { cpf, otp } = req.body;

  try {
    console.log("--------------------------------------------------");
    console.log("[SERVER] Iniciando Validação - Passo 1: Token");

    // Chamamos apenas o método de autenticação
    const authData = await SolutiService.getAcessToken(cpf, otp);

    console.log("[SERVER] Sucesso! Token gerado e validado.");

    // Retornamos os dados do token para conferência no seu Client (Postman/Frontend)
    return res.status(200).json({
      status: "Sucesso",
      mensagem: "Passo 1 concluído: Autenticação realizada com sucesso.",
      data: authData,
    });

    /* // ============================================================
    // RESTANTE DO CÓDIGO COMENTADO PARA VALIDAÇÃO POR ETAPAS
    // ============================================================
    
    /*
    console.log("[SERVER] Iniciando Passo 2: Preparação do Documento...");
    const docPreparado = await SolutiService.prepararDocumento(authData.access_token, req.body.pdf);
    
    console.log("[SERVER] Iniciando Passo 3: Assinatura...");
    const resultadoAssinatura = await SolutiService.assinar(authData.access_token, docPreparado.id);
    
    res.json({ success: true, assinatura: resultadoAssinatura });
    */
  } catch (error) {
    console.error("[SERVER] ❌ Erro no Passo 1:", error.message);

    res.status(500).json({
      status: "Erro",
      mensagem: "Falha ao validar token da Soluti",
      erro: error.message,
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
