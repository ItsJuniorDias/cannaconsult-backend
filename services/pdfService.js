// pdfService.js (Versão Produção)
const { plainAddPlaceholder } = require("@signpdf/placeholder-plain");
const { PDFDocument } = require("pdf-lib"); // Adicione a importação do pdf-lib
const crypto = require("crypto");

class PdfService {
  // 1. Prepara o PDF com o espaço para a assinatura padrão PAdES
  static async preparePdf(pdfBuffer) {
    // Transforme em async

    // PASSO NOVO: Normalizar o PDF removendo os Object Streams
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const normalizedBytes = await pdfDoc.save({ useObjectStreams: false });
    const normalizedBuffer = Buffer.from(normalizedBytes);

    // DICA: 8192 pode ser pequeno para algumas cadeias da Soluti/BirdID.
    // Se der erro de "Assinatura retornada é maior...", aumente para 16384.
    const signatureLength = 16384;

    // plainAddPlaceholder cria o dicionário de assinatura e o ByteRange correto
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer: normalizedBuffer, // Passa o buffer normalizado!
      reason: "Assinatura Digital BirdID",
      signatureLength: signatureLength,
    });

    return pdfWithPlaceholder;
  }

  // 2. Extrai exatamente o que precisa ser "hasheado"
  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    const byteRangeMatch = pdfString.match(
      /\/ByteRange\s*\[(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]/,
    );
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
    const byteRangeMatch = pdfString.match(
      /\/ByteRange\s*\[(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]/,
    );

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1] + 1;
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2] - 1;

    const reservedSpaceSize = signatureEnd - signatureStart;

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
