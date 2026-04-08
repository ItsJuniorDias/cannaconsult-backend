// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");

const { PDFDocument } = require("pdf-lib");
const { plainAddPlaceholder } = require("@signpdf/placeholder-plain");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const SIGNATURE_LENGTH = 8192;
const app = express();

app.use(cors());
app.use(express.json());

// ============================================================================
// FUNÇÃO AUXILIAR: VALIDAÇÃO DO RECAPTCHA
// ============================================================================
async function verificarCaptcha(token) {
  if (!token) return false;

  const secretKey = process.env.RECAPTCHA_SECRET_KEY; // Chave secreta do seu .env

  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      null,
      {
        params: {
          secret: secretKey,
          response: token,
        },
      },
    );

    // Retorna true se for um humano válido, ou false se falhar
    return response.data.success;
  } catch (error) {
    console.error("Erro ao validar reCAPTCHA no Google:", error.message);
    return false;
  }
}

// ============================================================================
// ENDPOINT DE ASSINATURA BIRD ID (Em lote: Laudo e Receita)
// ============================================================================
app.post("/api/assinar-birdid", async (req, res) => {
  const { laudoId, otp, credentialId } = req.body;

  if (!laudoId || !otp || !credentialId) {
    return res
      .status(400)
      .json({ error: "laudoId, otp e credentialId são obrigatórios." });
  }

  try {
    // 1. Gerar/Obter os buffers dos dois PDFs
    let pdfLaudoBuffer = await gerarPdfDoLaudoBackend(laudoId);
    let pdfReceitaBuffer = await gerarPdfDaReceitaBackend(laudoId);

    // 2. Preparar os placeholders e gerar os hashes de ambos
    const preparacaoLaudo = prepararByteRangeEGerarHash(pdfLaudoBuffer);
    const preparacaoReceita = prepararByteRangeEGerarHash(pdfReceitaBuffer);

    // 3. Obter token de acesso do Soluti/BirdID
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "client_credentials");
    tokenParams.append("client_id", process.env.SOLUTI_CLIENT_ID);
    tokenParams.append("client_secret", process.env.SOLUTI_CLIENT_SECRET);

    const authResponse = await axios.post(
      "https://api.birdid.com.br/oauth/token",
      tokenParams,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const accessToken = authResponse.data.access_token;
    console.log("Token de acesso obtido com sucesso para assinatura em lote!");

    // 4. Enviar os DOIS hashes em uma única requisição para o BirdID
    const signResponse = await axios.post(
      "https://api.birdid.com.br/csc/v1/signatures/signHash",
      {
        credentialID: credentialId,
        SAD: otp,
        // Array com os hashes na ordem: [Laudo, Receita]
        hash: [preparacaoLaudo.hashDocumento, preparacaoReceita.hashDocumento],
        hashAlgorithm: "2.16.840.1.101.3.4.2.1",
        signAlgo: "1.2.840.113549.1.1.11",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    // 5. O BirdID devolve as assinaturas na mesma ordem que enviamos os hashes
    const assinaturaLaudoBase64 = signResponse.data.signatures[0];
    const assinaturaReceitaBase64 = signResponse.data.signatures[1];

    // 6. Embutir as respectivas assinaturas em seus PDFs
    const laudoAssinadoBuffer = await embutirAssinaturaNoPDF(
      preparacaoLaudo.pdfPreparadoBuffer,
      assinaturaLaudoBase64,
    );
    const receitaAssinadaBuffer = await embutirAssinaturaNoPDF(
      preparacaoReceita.pdfPreparadoBuffer,
      assinaturaReceitaBase64,
    );

    // 7. Retornar os dois PDFs assinados em Base64 para o Frontend
    return res.status(200).json({
      success: true,
      message: "Laudo e Receita assinados com sucesso",
      laudoAssinadoBase64: laudoAssinadoBuffer.toString("base64"),
      receitaAssinadaBase64: receitaAssinadaBuffer.toString("base64"),
    });
  } catch (error) {
    console.error("Erro na assinatura:", error.response?.data || error.message);
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res
        .status(401)
        .json({ error: "Código OTP inválido ou expirado." });
    }
    return res
      .status(500)
      .json({ error: "Erro interno ao tentar assinar os documentos." });
  }
});

// ============================================================================
// FUNÇÕES AUXILIARES DE PDF
// ============================================================================

async function gerarPdfDoLaudoBackend(laudoId) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);

  page.drawText(`Laudo Médico/Técnico - ID: ${laudoId}`, {
    x: 50,
    y: 750,
    size: 20,
  });
  page.drawText("Conteúdo do laudo...", { x: 50, y: 700, size: 12 });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  let pdfBuffer = Buffer.from(pdfBytes);

  pdfBuffer = plainAddPlaceholder({
    pdfBuffer,
    reason: "Assinatura Digital do Laudo",
    signatureLength: SIGNATURE_LENGTH,
  });

  return pdfBuffer;
}

async function gerarPdfDaReceitaBackend(laudoId) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);

  page.drawText(`Receita Médica - ID: ${laudoId}`, {
    x: 50,
    y: 750,
    size: 20,
  });
  page.drawText("Prescrição de medicamentos e dosagens...", {
    x: 50,
    y: 700,
    size: 12,
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  let pdfBuffer = Buffer.from(pdfBytes);

  pdfBuffer = plainAddPlaceholder({
    pdfBuffer,
    reason: "Assinatura Digital da Receita",
    signatureLength: SIGNATURE_LENGTH,
  });

  return pdfBuffer;
}

function prepararByteRangeEGerarHash(pdfBuffer) {
  const pdfString = pdfBuffer.toString("binary");

  const byteRangePos = pdfString.indexOf("/ByteRange [");
  if (byteRangePos === -1) throw new Error("Placeholder não encontrado.");

  const byteRangeEnd = pdfString.indexOf("]", byteRangePos);
  const signatureStart = pdfString.indexOf("<", byteRangeEnd);
  const signatureEnd = pdfString.indexOf(">", signatureStart) + 1;

  const byteRange = [
    0,
    signatureStart,
    signatureEnd,
    pdfBuffer.length - signatureEnd,
  ];

  const byteRangeString = `/ByteRange [${byteRange.join(" ")}]`;
  const espacoOriginal = byteRangeEnd + 1 - byteRangePos;
  const byteRangeFormatado = byteRangeString.padEnd(espacoOriginal, " ");

  pdfBuffer.write(byteRangeFormatado, byteRangePos, espacoOriginal, "binary");

  const hash = crypto.createHash("sha256");
  hash.update(pdfBuffer.subarray(0, signatureStart));
  hash.update(pdfBuffer.subarray(signatureEnd));

  return {
    pdfPreparadoBuffer: pdfBuffer,
    hashDocumento: hash.digest("base64"),
  };
}

async function embutirAssinaturaNoPDF(pdfPreparadoBuffer, signatureBase64) {
  const signatureHex = Buffer.from(signatureBase64, "base64").toString("hex");
  const maxSignatureHexLength = SIGNATURE_LENGTH * 2;

  if (signatureHex.length > maxSignatureHexLength) {
    throw new Error("A assinatura é maior que o placeholder alocado.");
  }

  const paddedSignatureHex = signatureHex.padEnd(maxSignatureHexLength, "0");
  const pdfString = pdfPreparadoBuffer.toString("binary");
  const signatureStart = pdfString.indexOf("<") + 1;

  pdfPreparadoBuffer.write(
    paddedSignatureHex,
    signatureStart,
    maxSignatureHexLength,
    "hex",
  );

  return pdfPreparadoBuffer;
}

// ============================================================================
// ENDPOINTS DE CHECKOUT
// ============================================================================

app.post("/api/checkout/pix", async (req, res) => {
  try {
    // 1. Extrai o captchaToken enviado pelo frontend
    const { customer, items, captchaToken } = req.body;

    if (!customer || !items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Dados do cliente ou itens do carrinho inválidos." });
    }

    // 2. Validação do Captcha (A barreira contra bots)
    const isHuman = await verificarCaptcha(captchaToken);
    if (!isHuman) {
      return res
        .status(403)
        .json({ error: "Falha de segurança. Verificação de bot rejeitada." });
    }

    // 3. Se for humano, cria o pedido no Pagar.me
    const result = await createPixOrder(customer, items);
    res.json(result);
  } catch (error) {
    console.error("Erro no checkout PIX:", error);
    res.status(500).json({ error: "Falha no checkout via PIX." });
  }
});

app.post("/api/checkout/cartao", async (req, res) => {
  try {
    // 1. Extrai o captchaToken enviado pelo frontend
    const { customer, items, cardToken, installments, captchaToken } = req.body;

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

    // 2. Validação do Captcha (A barreira contra bots)
    const isHuman = await verificarCaptcha(captchaToken);
    if (!isHuman) {
      return res
        .status(403)
        .json({ error: "Falha de segurança. Verificação de bot rejeitada." });
    }

    // 3. Se for humano, cria o pedido no Pagar.me
    const result = await createCreditCardOrder(
      customer,
      items,
      cardToken,
      installments || 1,
    );

    if (result.status === "failed") {
      return res.status(402).json({
        success: false,
        message: "Pagamento recusado pelo banco emissor.",
        orderId: result.orderId,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Pagamento aprovado com sucesso!",
      orderId: result.orderId,
      status: result.status,
    });
  } catch (error) {
    console.error("Erro na rota de cartão de crédito:", error);
    return res.status(500).json({
      success: false,
      error: "Ocorreu um erro interno ao processar seu pagamento.",
    });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
