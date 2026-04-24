// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const SolutiService = require("./services/solutiService");
const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

// Importando o SDK do Mercado Pago
const { Payment } = require("mercadopago");
const mpClient = require("./services/mercadoPagoService");

const app = express();

app.use(cors());
// Aumenta o limite do JSON para 50 megabytes para suportar arquivos PDF em base64
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Rota 1: Gerar URL
app.get("/api/auth-url", (req, res) => {
  const url = `${process.env.SOLUTI_OAUTH_URL}/authorize?client_id=${process.env.SOLUTI_CLIENT_ID}&redirect_uri=${process.env.SOLUTI_REDIRECT_URI}&response_type=code&scope=signature`;
  res.json({ url });
});

// ============================================================================
// ROTAS DO BIRD ID (SOLUTI)
// ============================================================================

// 1. Rota para trocar o Authorization Code pelo Access Token
app.post("/api/auth/birdid/callback", async (req, res) => {
  const { code, code_verifier } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Código de autorização ausente." });
  }
  if (!code_verifier) {
    return res
      .status(400)
      .json({ error: "Parâmetro PKCE (code_verifier) ausente." });
  }

  try {
    const tokenResponse = await SolutiService.getAccessToken(
      code,
      code_verifier,
    );

    const accessToken =
      typeof tokenResponse === "string"
        ? tokenResponse
        : tokenResponse.access_token;

    console.log("Access Token recebido com sucesso!");
    res.json({ access_token: accessToken });
  } catch (error) {
    console.error("Erro ao gerar token BirdID:", error);
    res
      .status(500)
      .json({ error: error.message || "Falha interna ao gerar token" });
  }
});

// ============================================================================
// FUNÇÃO AUXILIAR: ASSINATURA DE DOCUMENTO (CESS / PAdES)
// ============================================================================
async function assinarDocumento(cpf, otp, pdfBase64) {
  console.log("--------------------------------------------------");
  console.log("[SERVER] Iniciando Fluxo de Assinatura CESS (PAdES)");
  console.log("[SERVER] 1. Solicitando Token via OTP...");

  // Verifica as credenciais e obtém o schema de autorização do Bird ID
  const authData = await SolutiService.getAcessToken(cpf, otp);
  const tokenSchema = authData.authorization_schema;

  console.log("[SERVER] -> Token obtido com sucesso.");

  console.log("[SERVER] 2. Preparando documento...");
  const preparacao = await SolutiService.prepararDocumento(
    pdfBase64,
    tokenSchema,
  );

  if (preparacao.status === "SIGNED") {
    console.log(
      "[SERVER] -> Documento assinado automaticamente (Modo Síncrono).",
    );
    console.log("[SERVER] -> Baixando arquivo final...");
    return await SolutiService.baixarDocumentoAssinado(
      preparacao.download_url,
      tokenSchema,
    );
  }

  if (preparacao.status === "PENDING" && preparacao.prepared_hash) {
    console.log("[SERVER] 3. Assinando hash manualmente...");
    const assinatura = await SolutiService.assinarHash(
      tokenSchema,
      preparacao.prepared_hash,
    );

    if (assinatura?.documents?.[0]?.result) {
      console.log("[SERVER] -> Baixando arquivo final...");
      return await SolutiService.baixarDocumentoAssinado(
        assinatura.documents[0].result,
        tokenSchema,
      );
    }
  }

  throw new Error(
    "A API não retornou um estado válido para concluir a assinatura.",
  );
}

// ============================================================================
// ROTAS DE ASSINATURA SEPARADAS
// ============================================================================

// Rota 1: Assinatura da Receita (Prescrição)
app.post("/api/sign/receita", async (req, res) => {
  const { cpf, otp, pdfBase64 } = req.body;

  if (!cpf || !otp || !pdfBase64) {
    return res.status(400).json({
      status: "Erro",
      mensagem: "CPF, OTP e pdfBase64 são obrigatórios.",
    });
  }

  try {
    const finalPdfBase64 = await assinarDocumento(cpf, otp, pdfBase64);

    console.log("[SERVER] ✅ Receita assinada com sucesso!");
    return res.status(200).json({
      status: "Sucesso",
      mensagem: "Receita assinada com sucesso.",
      data: {
        pdfBase64: finalPdfBase64,
        tipo: "Prescrição Médica",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const detalhe =
      error?.response?.data || error.message || "Erro desconhecido";
    console.error("[SERVER] ❌ Erro ao assinar receita:", detalhe);
    return res.status(500).json({
      status: "Erro",
      mensagem: "Falha na integração com Soluti CESS",
      erro: detalhe,
    });
  }
});

// Rota 2: Assinatura do Laudo
app.post("/api/sign/laudo", async (req, res) => {
  const { cpf, otp, pdfBase64 } = req.body;

  if (!cpf || !otp || !pdfBase64) {
    return res.status(400).json({
      status: "Erro",
      mensagem: "CPF, OTP e pdfBase64 são obrigatórios.",
    });
  }

  try {
    const finalPdfBase64 = await assinarDocumento(cpf, otp, pdfBase64);

    console.log("[SERVER] ✅ Laudo assinado com sucesso!");
    return res.status(200).json({
      status: "Sucesso",
      mensagem: "Laudo assinado com sucesso.",
      data: {
        pdfBase64: finalPdfBase64,
        tipo: "Laudo Médico",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const detalhe =
      error?.response?.data || error.message || "Erro desconhecido";
    console.error("[SERVER] ❌ Erro ao assinar laudo:", detalhe);
    return res.status(500).json({
      status: "Erro",
      mensagem: "Falha na integração com Soluti CESS",
      erro: detalhe,
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
// ENDPOINTS DE CHECKOUT E PAGAMENTO
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

// ============================================================================
// NOVO ENDPOINT: CONSULTAR STATUS DO PAGAMENTO (Usado pelo frontend para o PIX)
// ============================================================================
app.get("/api/checkout/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ error: "ID do pagamento não fornecido." });
    }

    const payment = new Payment(mpClient);
    const paymentInfo = await payment.get({ id: orderId });

    let mappedStatus = paymentInfo.status;
    if (paymentInfo.status === "approved") {
      mappedStatus = "paid";
    }

    return res.status(200).json({ status: mappedStatus });
  } catch (error) {
    console.error(
      "Erro ao consultar status do pedido:",
      error.message || error,
    );
    return res
      .status(500)
      .json({ error: "Não foi possível verificar o status." });
  }
});

// ============================================================================
// WEBHOOK MERCADO PAGO (Para ouvir atualizações em background)
// ============================================================================
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    console.log(
      "[Webhook MP] Payload body:",
      JSON.stringify(req.body, null, 2),
    );
    console.log("[Webhook MP] Query params:", req.query);

    const paymentId =
      req.body?.data?.id || req.query?.id || req.query?.["data.id"];
    const type = req.body?.type || req.query?.topic;

    if (!paymentId) {
      console.log("[Webhook MP] Notificação ignorada (Sem ID de pagamento).");
      return res.status(200).send("OK");
    }

    if (type === "payment" || req.body?.action?.startsWith("payment")) {
      console.log(`[Webhook MP] Consultando pagamento real ID: ${paymentId}`);

      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log(
        `[Webhook MP] Status do pagamento ${paymentId} mudou para: ${paymentInfo.status}`,
      );
    }

    return res.status(200).send("OK");
  } catch (error) {
    const errorMessage =
      error.message || error.response?.data?.message || "Erro desconhecido";
    console.error(`[Webhook MP] Erro na consulta do ID: ${errorMessage}`);

    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
