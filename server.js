// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios"); // [CORREÇÃO] Faltava importar o axios

const { PDFDocument } = require("pdf-lib");
const { plainAddPlaceholder } = require("@signpdf/placeholder-plain");

const { createPixOrder } = require("./controller/pixService");
const { createCreditCardOrder } = require("./controller/creditCardService");

const SIGNATURE_LENGTH = 8192;
const app = express();

app.use(cors());
app.use(express.json());

// ============================================================================
// ENDPOINT DE ASSINATURA BIRD ID
// ============================================================================
app.post("/api/assinar-birdid", async (req, res) => {
  const { laudoId, otp, credentialId } = req.body;

  if (!laudoId || !otp || !credentialId) {
    return res
      .status(400)
      .json({ error: "laudoId, otp e credentialId são obrigatórios." });
  }

  try {
    // 1. OBTER OU GERAR O PDF COM PLACEHOLDER
    let pdfBuffer = await gerarPdfDoLaudoBackend(laudoId);

    // 2. PREPARAR O BYTERANGE E GERAR O HASH CORRETO
    const { pdfPreparadoBuffer, hashDocumento } =
      prepararByteRangeEGerarHash(pdfBuffer);

    // =====================================================================
    // 3. INTEGRAÇÃO COM A API DO BIRD ID (SOLUTI)
    // =====================================================================

    // 👇 CORREÇÃO AQUI: Usando URLSearchParams para formato x-www-form-urlencoded 👇
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
    console.log("Token de acesso obtido com sucesso!");

    // Chamada para assinar o hash (Mantida como você fez, JSON aqui é correto!)
    const signResponse = await axios.post(
      "https://api.birdid.com.br/csc/v1/signatures/signHash",
      {
        credentialID: credentialId,
        SAD: otp,
        hash: [hashDocumento],
        hashAlgorithm: "2.16.840.1.101.3.4.2.1", // OID do SHA-256
        signAlgo: "1.2.840.113549.1.1.11", // OID do RSA com SHA-256
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const assinaturaBase64 = signResponse.data.signatures[0];

    // =====================================================================
    // 4. EMBUTIR A ASSINATURA NO PDF
    // =====================================================================
    const pdfAssinadoBuffer = await embutirAssinaturaNoPDF(
      pdfPreparadoBuffer,
      assinaturaBase64,
    );

    // =====================================================================
    // 5. DEVOLVER PARA O FRONTEND
    // =====================================================================
    return res.status(200).json({
      success: true,
      message: "Laudo assinado com sucesso",
      pdfAssinadoBase64: pdfAssinadoBuffer.toString("base64"),
    });
  } catch (error) {
    // Log detalhado para te ajudar no debug
    console.error("Erro na assinatura:", error.response?.data || error.message);

    if (error.response?.status === 401 || error.response?.status === 403) {
      return res
        .status(401)
        .json({ error: "Código OTP inválido ou expirado." });
    }

    return res
      .status(500)
      .json({ error: "Erro interno ao tentar assinar o documento." });
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

  // 👇 A MÁGICA ACONTECE AQUI 👇
  // Desativa os Object Streams para que o node-signpdf consiga ler o xref
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });

  let pdfBuffer = Buffer.from(pdfBytes);

  pdfBuffer = plainAddPlaceholder({
    pdfBuffer,
    reason: "Assinatura Digital do Laudo",
    signatureLength: SIGNATURE_LENGTH, // Garanta que SIGNATURE_LENGTH está definido (ex: 8192)
  });

  return pdfBuffer;
}

/**
 * [NOVA FUNÇÃO] Calcula o ByteRange e gera o Hash exigido pela Soluti
 */
function prepararByteRangeEGerarHash(pdfBuffer) {
  const pdfString = pdfBuffer.toString("binary");

  // Localiza os marcadores do placeholder
  const byteRangePos = pdfString.indexOf("/ByteRange [");
  if (byteRangePos === -1) throw new Error("Placeholder não encontrado.");

  const byteRangeEnd = pdfString.indexOf("]", byteRangePos);
  const signatureStart = pdfString.indexOf("<", byteRangeEnd);
  const signatureEnd = pdfString.indexOf(">", signatureStart) + 1;

  // Monta o array de ByteRange: [inicio, tamanho1, inicio2, tamanho2]
  const byteRange = [
    0,
    signatureStart,
    signatureEnd,
    pdfBuffer.length - signatureEnd,
  ];

  // Substitui os zeros do placeholder pelo ByteRange real (mantendo o tamanho exato da string para não quebrar o arquivo)
  const byteRangeString = `/ByteRange [${byteRange.join(" ")}]`;
  const espacoOriginal = byteRangeEnd + 1 - byteRangePos;
  const byteRangeFormatado = byteRangeString.padEnd(espacoOriginal, " ");

  pdfBuffer.write(byteRangeFormatado, byteRangePos, espacoOriginal, "binary");

  // O Hash que a Soluti assina precisa ser APENAS das partes do PDF antes e depois da assinatura
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

  // Preenche com zeros à direita para não alterar o tamanho final do arquivo
  const paddedSignatureHex = signatureHex.padEnd(maxSignatureHexLength, "0");

  const pdfString = pdfPreparadoBuffer.toString("binary");
  const signatureStart = pdfString.indexOf("<") + 1; // +1 para pular o '<'

  // Substitui os zeros do placeholder pela assinatura hexadecimal
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
    const { customer, items } = req.body;

    // [CORREÇÃO] Validação básica adicionada
    if (!customer || !items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Dados do cliente ou itens do carrinho inválidos." });
    }

    const result = await createPixOrder(customer, items);
    res.json(result);
  } catch (error) {
    console.error("Erro no checkout PIX:", error);
    res.status(500).json({ error: "Falha no checkout via PIX." });
  }
});

app.post("/api/checkout/cartao", async (req, res) => {
  try {
    const { customer, items, cardToken, installments } = req.body;

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
