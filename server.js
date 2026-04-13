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

// 2. Rota para Assinar os Documentos (Laudo e Receita)
app.post("/api/sign", async (req, res) => {
  const { token, laudos, otp } = req.body;

  // 🔴 Validação robusta
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token inválido." });
  }

  if (!otp) {
    return res.status(400).json({ error: "OTP é obrigatório." });
  }

  if (!laudos || typeof laudos !== "object") {
    return res.status(400).json({ error: "Dados de laudos inválidos." });
  }

  try {
    // 📥 Download resiliente
    const downloadPdf = async (url) => {
      if (!url) return null;

      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 20000,
        });

        if (!response.data) {
          throw new Error("Resposta vazia ao baixar PDF");
        }

        return Buffer.from(response.data);
      } catch (err) {
        console.error(`❌ Erro ao baixar PDF: ${url}`, err.message);
        throw new Error(`Falha ao baixar PDF`);
      }
    };

    const pdfLaudoBuffer = await downloadPdf(
      laudos.laudoPdfUrl || laudos.documentoPdfUrl,
    );

    const pdfReceitaBuffer = await downloadPdf(laudos.receitaPdfUrl);

    if (!pdfLaudoBuffer && !pdfReceitaBuffer) {
      return res.status(400).json({ error: "Nenhum PDF encontrado." });
    }

    let laudoAssinado = null;
    let receitaAssinada = null;

    // ==========================================
    // 🧾 LAUDO
    // ==========================================
    if (pdfLaudoBuffer) {
      try {
        console.log("⚙️ Processando Laudo...");

        const laudoPrep = await PdfService.preparePdf(pdfLaudoBuffer);
        const laudoHash = PdfService.calculateHashForSigning(laudoPrep);

        if (!laudoHash) {
          throw new Error("Falha ao gerar hash do laudo");
        }

        const assinaturaCMSBase64 = await SolutiService.signHash(
          laudoHash,
          token,
        );

        laudoAssinado = PdfService.injectSignature(
          Buffer.from(laudoPrep), // 🔴 evita mutação acidental
          assinaturaCMSBase64,
        );

        console.log("✅ Laudo assinado com sucesso");
      } catch (err) {
        console.error("❌ Erro ao assinar laudo:", err.message);
        throw new Error(`Erro no laudo: ${err.message}`);
      }
    }

    // ==========================================
    // 💊 RECEITA
    // ==========================================
    if (pdfReceitaBuffer) {
      try {
        console.log("⚙️ Processando Receita...");

        const receitaPrep = await PdfService.preparePdf(pdfReceitaBuffer);
        const receitaHash = PdfService.calculateHashForSigning(receitaPrep);

        if (!receitaHash) {
          throw new Error("Falha ao gerar hash da receita");
        }

        const assinaturaCMSBase64 = await SolutiService.signHash(
          receitaHash,
          token,
        );

        receitaAssinada = PdfService.injectSignature(
          Buffer.from(receitaPrep),
          assinaturaCMSBase64,
        );

        console.log("✅ Receita assinada com sucesso");
      } catch (err) {
        console.error("❌ Erro ao assinar receita:", err.message);
        throw new Error(`Erro na receita: ${err.message}`);
      }
    }

    console.log("🎉 Documentos assinados com sucesso!");

    return res.status(200).json({
      success: true,
      documentos: {
        laudo: laudoAssinado ? laudoAssinado.toString("base64") : null,
        receita: receitaAssinada ? receitaAssinada.toString("base64") : null,
      },
    });
  } catch (error) {
    console.error("❌ Erro geral:", error.message);

    return res.status(500).json({
      error: error.message || "Erro interno ao assinar documentos",
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
