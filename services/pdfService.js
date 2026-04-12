// pdfService.js (Versão Definitiva - Cloud Signing)
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

// Regex para encontrar os números do ByteRange
const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Carregando PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    const placeholderPkg = require("@signpdf/placeholder-pdf-lib");
    const addPlaceholder =
      placeholderPkg.pdflibAddPlaceholder ||
      placeholderPkg.default?.pdflibAddPlaceholder ||
      placeholderPkg.pdfLibAddPlaceholder;

    console.log("[PdfService] 2. Injetando Placeholder com asteriscos...");
    addPlaceholder({
      pdfDoc: pdfDoc,
      reason: "Assinatura Medica BirdID",
      contactInfo: "contato@clinica.com.br",
      name: "João Marcos Santos da Silva",
      location: "Brasil",
      signatureLength: 16384,
    });

    console.log("[PdfService] 3. Salvando PDF bruto...");
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    let finalBuffer = Buffer.from(pdfBytes);

    console.log(
      "[PdfService] 4. Resolvendo o ByteRange Dinâmico (Removendo asteriscos)...",
    );
    const pdfString = finalBuffer.toString("binary");

    // 4.1 Encontrar os limites da assinatura (<...>)
    const contentsStart = pdfString.lastIndexOf("/Contents <");
    if (contentsStart === -1)
      throw new Error("Erro: /Contents não encontrado no PDF gerado.");

    const contentsStartOffset = contentsStart + 11;
    const contentsEndOffset = pdfString.indexOf(">", contentsStartOffset) + 1;

    // Matemática dos bytes (Tamanho antes da assinatura, Início do final, Tamanho do final)
    const length1 = contentsStartOffset;
    const start2 = contentsEndOffset;
    const length2 = finalBuffer.length - start2;

    // 4.2 Localizar o texto original com os asteriscos gerado pelo pdf-lib
    const byteRangeStart = pdfString.lastIndexOf("/ByteRange");
    const byteRangeEnd = pdfString.indexOf("]", byteRangeStart) + 1;
    const originalByteRange = pdfString.substring(byteRangeStart, byteRangeEnd);

    // 4.3 Montar o ByteRange verdadeiro com os números calculados
    let realByteRange = `/ByteRange [0 ${length1} ${start2} ${length2}]`;

    if (realByteRange.length > originalByteRange.length) {
      throw new Error(
        "Tamanho do ByteRange real estourou o limite do placeholder.",
      );
    }

    // Preenche com espaços vazios para garantir que não corrompemos os bits do arquivo
    realByteRange = realByteRange.padEnd(originalByteRange.length, " ");

    // 4.4 Injetar o texto corrigido de volta no Buffer do PDF
    finalBuffer.write(
      realByteRange,
      byteRangeStart,
      realByteRange.length,
      "binary",
    );

    console.log(
      "[PdfService] 5. PDF Preparado com sucesso! ByteRange Realizado:",
      realByteRange.trim(),
    );
    return finalBuffer;
  }

  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    console.log("[PdfService] 6. Lendo ByteRange para o Hash...");
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);
    if (!byteRangeMatch) {
      throw new Error(
        "Falha no Hash: O ByteRange ainda está ilegível ou com asteriscos.",
      );
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

    console.log("[PdfService] 7. Gerando Hash SHA-256...");
    const documentToHash = Buffer.concat([part1, part2]);
    return crypto.createHash("sha256").update(documentToHash).digest("base64");
  }

  static injectSignature(pdfWithPlaceholderBuffer, signatureBase64) {
    console.log("[PdfService] 8. Iniciando injeção da assinatura real...");

    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);

    if (!byteRangeMatch)
      throw new Error("ByteRange sumiu na hora de injetar a assinatura.");

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1] + 1;
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2] - 1;
    const reservedSpaceSize = signatureEnd - signatureStart;

    console.log(
      `[PdfService] 9. Preenchendo espaço de ${reservedSpaceSize} caracteres...`,
    );
    signatureHex = signatureHex.padEnd(reservedSpaceSize, "0");

    if (signatureHex.length > reservedSpaceSize) {
      throw new Error(
        "Assinatura retornada pela BirdID é MAIOR que o espaço reservado no PDF (16384).",
      );
    }

    const finalPdfBuffer = Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(signatureHex, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);

    console.log("🎉 PDF Finalizado e assinado!");
    return finalPdfBuffer;
  }
}

module.exports = PdfService;
