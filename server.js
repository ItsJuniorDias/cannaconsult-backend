// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const SolutiService = require("./services/solutiService");
const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

// Importando o SDK do Mercado Pago (para usar no webhook, se necessário)
const { Payment } = require("mercadopago");
const mpClient = require("./services/mercadoPagoService");

const app = express();

app.use(cors());
// Aumenta o limite do JSON para 50 megabytes
app.use(express.json({ limit: "50mb" }));

// É uma boa prática aumentar o urlencoded também, caso esteja usando
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

/**
 * Rota para validação do Passo 1: Geração de Token
 */
app.post("/api/sign", async (req, res) => {
  const { cpf, otp, pdfBase64, tipoDocumento = "Prescrição Médica" } = req.body;

  try {
    console.log("--------------------------------------------------");
    console.log("[SERVER] Iniciando Fluxo de Assinatura CESS (PAdES)");

    if (!cpf || !otp || !pdfBase64) {
      return res.status(400).json({
        status: "Erro",
        mensagem: "CPF, OTP e pdfBase64 são obrigatórios.",
      });
    }

    console.log("[SERVER] 1. Solicitando Token...");
    const authData = await SolutiService.getAcessToken(cpf, otp);
    const tokenSchema = authData.authorization_schema;

    console.log("[SERVER] -> Token obtido com sucesso.");

    console.log("[SERVER] 2. Preparando documento...");
    const preparacao = await SolutiService.prepararDocumento(
      pdfBase64,
      tokenSchema,
    );

    let finalPdfBase64 = null;

    if (preparacao.status === "SIGNED") {
      console.log(
        "[SERVER] -> Documento assinado automaticamente (Modo Sincrono).",
      );
      console.log("[SERVER] -> Baixando arquivo final...");
      finalPdfBase64 = await SolutiService.baixarDocumentoAssinado(
        preparacao.download_url,
        tokenSchema,
      );
    } else if (preparacao.status === "PENDING" && preparacao.prepared_hash) {
      console.log("[SERVER] 3. Assinando hash manualmente...");
      const assinatura = await SolutiService.assinarHash(
        tokenSchema,
        preparacao.prepared_hash,
      );

      if (assinatura?.documents?.[0]?.result) {
        finalPdfBase64 = await SolutiService.baixarDocumentoAssinado(
          assinatura.documents[0].result,
          tokenSchema,
        );
      }
    } else {
      throw new Error(
        "A API não retornou um estado válido para concluir a assinatura.",
      );
    }

    console.log("[SERVER] ✅ Processo concluído com sucesso!");

    return res.status(200).json({
      status: "Sucesso",
      mensagem: "Documento assinado com sucesso.",
      data: {
        pdfBase64: finalPdfBase64,
        tipo: tipoDocumento,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const detalhe =
      error?.response?.data || error.message || "Erro desconhecido";
    console.error("[SERVER] ❌ Erro no processo:", detalhe);

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

// ============================================================================
// WEBHOOK MERCADO PAGO (Para ouvir atualizações de status de pagamento)
// ============================================================================
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    const { action, data, type } = req.body;

    // O Mercado Pago envia várias notificações, queremos apenas as de atualização de pagamento
    if (type === "payment" || action?.startsWith("payment")) {
      const paymentId = data?.id;

      console.log(
        `[Webhook MP] Recebida atualização para o pagamento ID: ${paymentId}`,
      );

      // Instancia o SDK para consultar o status real do pagamento
      const payment = new Payment(mpClient);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log(
        `[Webhook MP] Status do pagamento ${paymentId} mudou para: ${paymentInfo.status}`,
      );

      // TODO: Aqui você deve atualizar o status do pedido no seu Banco de Dados
      // Exemplo: if (paymentInfo.status === 'approved') { liberarConsultaOuReceita(paymentId) }
    }

    // É obrigatório responder ao Mercado Pago com 200 OK rapidamente
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Erro ao processar Webhook do Mercado Pago:", error);
    return res.status(500).send("Erro interno");
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
