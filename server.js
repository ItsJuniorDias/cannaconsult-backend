// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");

const helmet = require("helmet");
const SolutiService = require("./services/solutiService");
const PdfService = require("./services/pdfService");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const SIGNATURE_LENGTH = 8192;
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
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Código de autorização ausente" });
  }

  try {
    // Busca o Token na Soluti
    const tokenResponse = await SolutiService.getAccessToken(code);

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

// 2. Rota para Assinar os Documentos (Laudo e Receita)
app.post("/api/sign", async (req, res) => {
  const { token, laudos, otp } = req.body;

  // 1. Validação inicial
  if (!token || !laudos || !otp) {
    return res
      .status(400)
      .json({ error: "Token, dados do laudo e OTP são obrigatórios." });
  }

  try {
    console.log(
      `Iniciando assinatura para o paciente: ${laudos.paciente} | ID: ${laudos.id}`,
    );

    const urlLaudo = laudos.laudoPdfUrl || laudos.documentoPdfUrl;
    const urlReceita = laudos.receitaPdfUrl;

    // Função auxiliar para baixar o arquivo PDF como Buffer
    const downloadPdf = async (url) => {
      if (!url) return null;
      // IMPORTANTE: responseType 'arraybuffer' é vital para não corromper o PDF
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data);
    };

    // 2. Faz o download dos documentos disponíveis
    const pdfLaudoBuffer = await downloadPdf(urlLaudo);
    const pdfReceitaBuffer = await downloadPdf(urlReceita);

    if (!pdfLaudoBuffer && !pdfReceitaBuffer) {
      return res
        .status(400)
        .json({ error: "Nenhum documento em PDF encontrado para assinar." });
    }

    let laudoAssinadoBuffer = null;
    let receitaAssinadaBuffer = null;

    // 3. Processo de Assinatura do LAUDO
    if (pdfLaudoBuffer) {
      console.log("⚙️ Gerando hash e assinando Laudo...");
      // a) Prepara o PDF e extrai o Hash
      const laudoPreparado = await PdfService.preparePdf(pdfLaudoBuffer);
      const laudoHash =
        await PdfService.calculateHashForSigning(laudoPreparado);

      // b) Envia o Hash para a Soluti/BirdID assinar
      // A assinatura retornada geralmente é um Base64 (PKCS#7 ou CAdES)
      const assinaturaLaudo = await SolutiService.signHash(
        laudoHash,
        token,
        otp,
      );

      // c) Injeta a assinatura gráfica/metadados no PDF
      laudoAssinadoBuffer = await PdfService.injectSignature(
        laudoPreparado,
        assinaturaLaudo,
      );
    }

    // 4. Processo de Assinatura da RECEITA
    if (pdfReceitaBuffer) {
      console.log("⚙️ Gerando hash e assinando Receita...");
      const receitaPreparada = await PdfService.preparePdf(pdfReceitaBuffer);
      const receitaHash =
        await PdfService.calculateHashForSigning(receitaPreparada);

      const assinaturaReceita = await SolutiService.signHash(
        receitaHash,
        token,
        otp,
      );

      receitaAssinadaBuffer = await PdfService.injectSignature(
        receitaPreparada,
        assinaturaReceita,
      );
    }

    console.log("🎉 Documentos assinados com sucesso!");

    // Retorna o sucesso para o frontend
    res.status(200).json({
      success: true,
      message: "Documentos assinados com sucesso!",
      urls: {
        laudoBase64: laudoAssinadoBuffer
          ? laudoAssinadoBuffer.toString("base64")
          : null,
        receitaBase64: receitaAssinadaBuffer
          ? receitaAssinadaBuffer.toString("base64")
          : null,
      },
    });
  } catch (error) {
    console.error("❌ Erro no processo de assinatura:", error);

    // Tratamento de erro detalhado caso venha da API da Soluti (ex: OTP inválido)
    if (error.response && error.response.data) {
      return res.status(500).json({
        error:
          "Erro do provedor de assinatura: " +
          JSON.stringify(error.response.data),
      });
    }

    res
      .status(500)
      .json({ error: error.message || "Falha ao processar assinatura" });
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
