// pdfService.js
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Carregando PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Pega a última página para colocar o carimbo
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];

    const placeholderPkg = require("@signpdf/placeholder-pdf-lib");
    const addPlaceholder =
      placeholderPkg.pdflibAddPlaceholder ||
      placeholderPkg.default?.pdflibAddPlaceholder;

    addPlaceholder({
      pdfDoc: pdfDoc,
      page: lastPage, // Aplica na última página
      reason: "Assinatura Medica BirdID",
      contactInfo: "contato@clinica.com.br",
      name: "João Marcos Santos da Silva",
      location: "Brasil",
      signatureLength: 16384,
      widgetRect: [50, 50, 250, 100],
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    let finalBuffer = Buffer.from(pdfBytes);
    const pdfString = finalBuffer.toString("binary");

    // 🔴 Matemática exata para deixar o '<' e o '>' fora do Hash, mas dentro do arquivo
    const contentsStart = pdfString.lastIndexOf("/Contents <");
    const length1 = contentsStart + 10; // Aponta EXATAMENTE para o '<'
    const contentsEndOffset = pdfString.indexOf(">", length1);
    const start2 = contentsEndOffset + 1; // Aponta EXATAMENTE para logo após o '>'
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

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1]; // Aponta para o '<'
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2]; // Aponta logo após o '>'

    // O tamanho do buraco inclui o '<' e o '>'. Então subtraímos 2 para o hex.
    const gapSize = signatureEnd - signatureStart;
    const hexSpace = gapSize - 2;

    signatureHex = signatureHex.padEnd(hexSpace, "0");

    if (signatureHex.length > hexSpace) {
      throw new Error(
        "A assinatura PKCS7 retornada é maior que o espaço reservado.",
      );
    }

    // 🔴 A CORREÇÃO MESTRA: Colocando o '<' e o '>' de volta no Buffer final!
    return Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(`<${signatureHex}>`, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);
  }
}

module.exports = PdfService;
