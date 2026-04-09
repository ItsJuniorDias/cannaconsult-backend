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

// ============================================================================
// ENDPOINT PARA BUSCAR O CREDENTIAL ID PELO CPF
// ============================================================================
app.post("/api/buscar-certificado", async (req, res) => {
  try {
    const { cpf } = req.body;

    if (!cpf) {
      return res.status(400).json({ error: "O CPF é obrigatório." });
    }

    // 1. Limpar o CPF (manter apenas os números)
    const cpfLimpo = cpf.replace(/\D/g, "");

    // 2. Obter token de acesso do Soluti/BirdID
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
    const listResponse = await axios.post(
      "https://api.birdid.com.br/csc/v1/credentials/list",
      {
        userID: cpfLimpo, // Na API do BirdID, o CPF é enviado no campo userID
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const credentialIDs = listResponse.data.credentialIDs;

    // Se o array vier vazio ou não existir, o médico não tem BirdID ativo
    if (!credentialIDs || credentialIDs.length === 0) {
      return res.status(404).json({
        error: "Nenhum certificado BirdID ativo encontrado para este CPF.",
      });
    }

    // 4. Retorna o ID da credencial (geralmente pegamos a primeira [0])
    return res.status(200).json({
      success: true,
      credentialId: credentialIDs[0],
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
// ENDPOINT DE ASSINATURA BIRD ID (Preservando o visual original)
// ============================================================================
app.post("/api/assinar-birdid", async (req, res) => {
  const { laudoId, otp, credentialId, laudoPdfUrl, receitaPdfUrl } = req.body;

  if (!laudoId || !otp || !credentialId) {
    return res
      .status(400)
      .json({ error: "laudoId, otp e credentialId são obrigatórios." });
  }

  if (!laudoPdfUrl && !receitaPdfUrl) {
    return res
      .status(400)
      .json({ error: "É necessário enviar a URL do Laudo ou da Receita." });
  }

  try {
    const hashes = [];
    let preparacaoLaudo = null;
    let preparacaoReceita = null;

    // 1. Baixa os PDFs originais e prepara (adiciona placeholder sem mudar visual)
    if (laudoPdfUrl) {
      const laudoBuffer = await obterPdfOriginalEPreparar(
        laudoPdfUrl,
        "Assinatura Digital do Laudo",
      );
      preparacaoLaudo = prepararByteRangeEGerarHash(laudoBuffer);
      hashes.push(preparacaoLaudo.hashDocumento);
    }

    if (receitaPdfUrl) {
      const receitaBuffer = await obterPdfOriginalEPreparar(
        receitaPdfUrl,
        "Assinatura Digital da Receita",
      );
      preparacaoReceita = prepararByteRangeEGerarHash(receitaBuffer);
      hashes.push(preparacaoReceita.hashDocumento);
    }

    // 2. Obter token de acesso do Soluti/BirdID
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
    console.log("Token de acesso obtido com sucesso para assinatura!");

    // 3. Enviar os hashes em uma única requisição para o BirdID
    const signResponse = await axios.post(
      "https://api.birdid.com.br/csc/v1/signatures/signHash",
      {
        credentialID: credentialId,
        SAD: otp,
        hash: hashes,
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

    // 4. Embutir as assinaturas nos documentos correspondentes
    let laudoAssinadoBase64 = null;
    let receitaAssinadaBase64 = null;
    let indiceAssinatura = 0; // Controla qual assinatura da array pertence a qual documento

    if (preparacaoLaudo) {
      const assinaturaBase64 = signResponse.data.signatures[indiceAssinatura];
      const bufferAssinado = await embutirAssinaturaNoPDF(
        preparacaoLaudo.pdfPreparadoBuffer,
        assinaturaBase64,
      );
      laudoAssinadoBase64 = bufferAssinado.toString("base64");
      indiceAssinatura++;
    }

    if (preparacaoReceita) {
      const assinaturaBase64 = signResponse.data.signatures[indiceAssinatura];
      const bufferAssinado = await embutirAssinaturaNoPDF(
        preparacaoReceita.pdfPreparadoBuffer,
        assinaturaBase64,
      );
      receitaAssinadaBase64 = bufferAssinado.toString("base64");
    }

    // 5. Retornar os PDFs assinados mantendo 100% da integridade visual
    return res.status(200).json({
      success: true,
      message: "Documentos assinados com sucesso",
      laudoAssinadoBase64,
      receitaAssinadaBase64,
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

// NOVA FUNÇÃO: Faz download do PDF já existente e insere a camada de assinatura
async function obterPdfOriginalEPreparar(pdfUrl, motivo) {
  // Baixa o PDF do Firebase Storage (ou qualquer URL) como ArrayBuffer
  const response = await axios.get(pdfUrl, { responseType: "arraybuffer" });
  let pdfBuffer = Buffer.from(response.data);

  // Usa o @signpdf para alocar espaço para assinatura digital sem alterar a visão do documento
  pdfBuffer = plainAddPlaceholder({
    pdfBuffer,
    reason: motivo,
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
