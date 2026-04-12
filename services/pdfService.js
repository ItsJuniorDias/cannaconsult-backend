// pdfService.js
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Carregando PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    const placeholderPkg = require("@signpdf/placeholder-pdf-lib");
    const addPlaceholder =
      placeholderPkg.pdflibAddPlaceholder ||
      placeholderPkg.default?.pdflibAddPlaceholder;

    addPlaceholder({
      pdfDoc: pdfDoc,
      reason: "Assinatura Medica BirdID",
      contactInfo: "contato@clinica.com.br",
      name: "João Marcos Santos da Silva",
      location: "Brasil",
      signatureLength: 16384,
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    let finalBuffer = Buffer.from(pdfBytes);

    const pdfString = finalBuffer.toString("binary");

    const contentsStart = pdfString.lastIndexOf("/Contents <");
    const contentsStartOffset = contentsStart + 11;
    // 🔴 REMOVIDO o "+1" daqui para alinhar perfeitamente com o ">"
    const contentsEndOffset = pdfString.indexOf(">", contentsStartOffset);

    const length1 = contentsStartOffset;
    const start2 = contentsEndOffset;
    const length2 = finalBuffer.length - start2;

    const byteRangeStart = pdfString.lastIndexOf("/ByteRange");
    const byteRangeEnd = pdfString.indexOf("]", byteRangeStart) + 1;
    const originalByteRange = pdfString.substring(byteRangeStart, byteRangeEnd);

    let realByteRange = `/ByteRange [0 ${length1} ${start2} ${length2}]`;
    realByteRange = realByteRange.padEnd(originalByteRange.length, " ");

    finalBuffer.write(
      realByteRange,
      byteRangeStart,
      realByteRange.length,
      "binary",
    );
    return finalBuffer;
  }

  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);

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
    return crypto.createHash("sha256").update(documentToHash).digest("base64");
  }

  static injectSignature(pdfWithPlaceholderBuffer, signatureBase64) {
    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);

    // 🔴 REMOVIDOS os "+1" e "-1" daqui. Agora a matemática é milimetricamente exata.
    const signatureStart = byteRangeMatch.slice(1).map(Number)[1];
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2];

    const reservedSpaceSize = signatureEnd - signatureStart;

    signatureHex = signatureHex.padEnd(reservedSpaceSize, "0");

    if (signatureHex.length > reservedSpaceSize) {
      throw new Error(
        "A assinatura PKCS7 retornada é maior que o espaço de 16384 bytes.",
      );
    }

    return Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(signatureHex, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);
  }
}

module.exports = PdfService;
