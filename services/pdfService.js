// pdfService.js (Versão Definitiva - Padrão Adobe Acrobat)
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Carregando PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];

    const placeholderPkg = require("@signpdf/placeholder-pdf-lib");
    const addPlaceholder =
      placeholderPkg.pdflibAddPlaceholder ||
      placeholderPkg.default?.pdflibAddPlaceholder;

    addPlaceholder({
      pdfDoc: pdfDoc,
      page: lastPage,
      reason: "Assinatura Medica BirdID",
      contactInfo: "contato@clinica.com.br",
      name: "Medico Responsavel",
      location: "Brasil",
      signatureLength: 16384,
      widgetRect: [50, 50, 250, 100],
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    let finalBuffer = Buffer.from(pdfBytes);
    const pdfString = finalBuffer.toString("binary");

    // 🔴 MATEMÁTICA PADRÃO ADOBE: O Hash EXCLUI o '<' e o '>'
    const contentsStart = pdfString.lastIndexOf("/Contents");
    const signatureGapStart = pdfString.indexOf("<", contentsStart); // Aponta EXATAMENTE para o '<'
    const signatureGapEnd = pdfString.indexOf(">", signatureGapStart) + 1; // Aponta EXATAMENTE para DEPOIS do '>'

    const length1 = signatureGapStart;
    const start2 = signatureGapEnd;
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
    // Transforma o Base64 limpo em Hexadecimal puro
    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1]; // Bate exatamente no '<'
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2]; // Bate exatamente após o '>'

    const gapSize = signatureEnd - signatureStart;
    const hexSpace = gapSize - 2; // Desconta o espaço do '<' e do '>'

    signatureHex = signatureHex.padEnd(hexSpace, "0");

    if (signatureHex.length > hexSpace) {
      throw new Error(
        "A assinatura PKCS7 retornada é maior que o espaço reservado.",
      );
    }

    // 🔴 INJEÇÃO PADRÃO ADOBE: Recriamos o '<' e o '>' ao redor do Hexadecimal
    return Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(`<${signatureHex}>`, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);
  }
}

module.exports = PdfService;
