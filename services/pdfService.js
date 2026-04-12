// pdfService.js (Versão Produção)
const { pdflibAddPlaceholder } = require("@signpdf/placeholder-pdf-lib"); // <-- Corrigido (L minúsculo)
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

// REGEX RELAXADO: Fundamental para o pdf-lib, pois ele insere espaços extras dentro dos colchetes
const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  // 1. Prepara o PDF com o espaço para a assinatura padrão PAdES
  static async preparePdf(pdfBuffer) {
    // Carrega o PDF original na memória usando o pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    const signatureLength = 16384;

    // IMPORTANTE: pdflibAddPlaceholder recebe o objeto 'pdfDoc', não o buffer!
    // Ele insere o placeholder diretamente na instância do documento.
    pdflibAddPlaceholder({
      // <-- Corrigido (L minúsculo)
      pdfDoc: pdfDoc,
      reason: "Assinatura Digital BirdID",
      signatureLength: signatureLength,
    });

    // Salva o documento (agora com o placeholder) desativando o ObjectStreams
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });

    // Retorna como Buffer para os próximos passos
    return Buffer.from(pdfBytes);
  }

  // 2. Extrai exatamente o que precisa ser "hasheado"
  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    // Usa o Regex relaxado
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);
    if (!byteRangeMatch) {
      throw new Error("Não foi possível encontrar o ByteRange no PDF");
    }

    const byteRange = byteRangeMatch.slice(1).map(Number);

    const part1 = pdfWithPlaceholderBuffer.subarray(
      byteRange[0],
      byteRange[0] + byteRange[1],
    );
    const part2 = pdfWithPlaceholderBuffer.subarray(
      byteRange[2],
      byteRange[2] + byteRange[3],
    );

    const documentToHash = Buffer.concat([part1, part2]);
    const hash = crypto
      .createHash("sha256")
      .update(documentToHash)
      .digest("base64");

    return hash;
  }

  // 3. Injeta a assinatura de volta no local exato
  static injectSignature(pdfWithPlaceholderBuffer, signatureBase64) {
    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    // Usa o Regex relaxado aqui também
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);
    if (!byteRangeMatch) {
      throw new Error(
        "ByteRange não encontrado na hora de injetar a assinatura.",
      );
    }

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1] + 1;
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2] - 1;

    const reservedSpaceSize = signatureEnd - signatureStart;

    // Preenche com zeros se a assinatura for menor que o espaço
    signatureHex = signatureHex.padEnd(reservedSpaceSize, "0");

    if (signatureHex.length > reservedSpaceSize) {
      throw new Error(
        "Assinatura retornada é maior que o espaço reservado no PDF.",
      );
    }

    const finalPdfBuffer = Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(signatureHex, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);

    return finalPdfBuffer;
  }
}

module.exports = PdfService;
