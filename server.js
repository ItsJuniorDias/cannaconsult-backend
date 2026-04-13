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
  // Adicionei o 'cpf' no body, pois o BirdID Pro autentica via CPF + OTP
  const { cpf, laudos, otp } = req.body;

  // 🔴 Validação
  if (!cpf || !otp) {
    return res
      .status(400)
      .json({ error: "CPF e OTP são obrigatórios para BirdID Pro." });
  }

  if (!laudos || typeof laudos !== "object") {
    return res.status(400).json({ error: "Dados de laudos inválidos." });
  }

  try {
    // 📥 Download dos arquivos
    const downloadPdf = async (url) => {
      if (!url) return null;
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      return Buffer.from(response.data);
    };

    const pdfLaudoBuffer = await downloadPdf(
      laudos.laudoPdfUrl || laudos.documentoPdfUrl,
    );
    const pdfReceitaBuffer = await downloadPdf(laudos.receitaPdfUrl);

    if (!pdfLaudoBuffer && !pdfReceitaBuffer) {
      return res
        .status(400)
        .json({ error: "Nenhum PDF encontrado para assinatura." });
    }

    // 🔄 Função auxiliar para esperar a conclusão da assinatura (Polling)
    const aguardarEBaixar = async (tcn, docId) => {
      let tentativas = 0;
      const maxTentativas = 15; // ~30 segundos total (espera de 2s entre tentativas)

      while (tentativas < maxTentativas) {
        const status = await SolutiService.verificarStatus(tcn, docId);

        if (status.documentoStatus === "SIGNED") {
          return await SolutiService.baixarDocumentoAssinado(tcn, docId);
        }

        if (status.documentoStatus === "ERROR") {
          throw new Error(
            `Erro na Soluti para o documento ${docId}: ${status.erro}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 2000)); // Espera 2 segundos
        tentativas++;
      }
      throw new Error(`Timeout aguardando assinatura do documento ${docId}`);
    };

    const resultados = { laudo: null, receita: null };

    // ==========================================
    // 🧾 PROCESSO DE ASSINATURA (CESS)
    // ==========================================

    // Processamos ambos em paralelo para ganhar tempo
    const processos = [];

    if (pdfLaudoBuffer) {
      processos.push(
        (async () => {
          console.log("⚙️ Iniciando assinatura CESS: Laudo...");
          const tcn = await SolutiService.iniciarAssinaturaPAdES(
            cpf,
            otp,
            pdfLaudoBuffer.toString("base64"),
            "laudo_final",
          );
          const bufferAssinado = await aguardarEBaixar(tcn, "laudo_final");
          resultados.laudo = bufferAssinado.toString("base64");
          console.log("✅ Laudo assinado com sucesso via CESS");
        })(),
      );
    }

    if (pdfReceitaBuffer) {
      processos.push(
        (async () => {
          console.log("⚙️ Iniciando assinatura CESS: Receita...");
          const tcn = await SolutiService.iniciarAssinaturaPAdES(
            cpf,
            otp,
            pdfReceitaBuffer.toString("base64"),
            "receita_final",
          );
          const bufferAssinado = await aguardarEBaixar(tcn, "receita_final");
          resultados.receita = bufferAssinado.toString("base64");
          console.log("✅ Receita assinada com sucesso via CESS");
        })(),
      );
    }

    await Promise.all(processos);

    console.log("🎉 Todos os documentos foram processados!");

    return res.status(200).json({
      success: true,
      documentos: {
        laudo: resultados.laudo,
        receita: resultados.receita,
      },
    });
  } catch (error) {
    console.error("❌ Erro Geral no Fluxo BirdID Pro:", error.message);
    return res.status(500).json({
      error: error.message || "Erro interno ao processar assinatura no CESS",
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
