// pdfService.js (Versão Titânio)
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

// REGEX RELAXADO: Fundamental para o pdf-lib
const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Iniciando carregamento do PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Importação blindada (Trata as diferentes formas que o Node exporta a lib)
    const placeholderPkg = require("@signpdf/placeholder-pdf-lib");

    const addPlaceholder =
      placeholderPkg.pdfLibAddPlaceholder ||
      placeholderPkg.default?.pdfLibAddPlaceholder ||
      placeholderPkg.pdflibAddPlaceholder;

    if (typeof addPlaceholder !== "function") {
      throw new Error(
        "[CRÍTICO] A função de placeholder não foi encontrada no pacote @signpdf/placeholder-pdf-lib.",
      );
    }

    console.log("[PdfService] 2. Injetando Placeholder de Assinatura...");

    // Passamos TODOS os parâmetros de texto para evitar o erro de undefined.length dentro da lib
    addPlaceholder({
      pdfDoc: pdfDoc,
      reason: "Assinatura Medica BirdID",
      contactInfo: "contato@clinica.com.br", // Evita undefined interno
      name: "João Marcos Santos da Silva", // Evita undefined interno
      location: "Brasil", // Evita undefined interno
      signatureLength: 16384,
    });

    console.log("[PdfService] 3. Salvando PDF (Removendo ObjectStreams)...");
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });

    console.log("[PdfService] 4. Preparação concluída com sucesso!");
    return Buffer.from(pdfBytes);
  }

  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    console.log("[PdfService] 5. Extraindo ByteRange para o Hash...");
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);
    if (!byteRangeMatch) {
      throw new Error(
        "Não foi possível encontrar o ByteRange no PDF. A injeção falhou.",
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

    console.log("[PdfService] 6. Gerando Hash SHA-256...");
    const documentToHash = Buffer.concat([part1, part2]);
    return crypto.createHash("sha256").update(documentToHash).digest("base64");
  }

  static injectSignature(pdfWithPlaceholderBuffer, signatureBase64) {
    console.log("[PdfService] 7. Iniciando injeção da assinatura real...");

    // Proteção caso a Soluti tenha retornado undefined ou objeto vazio
    if (!signatureBase64 || typeof signatureBase64 !== "string") {
      throw new Error(
        "A assinatura Base64 retornada pela Soluti é inválida ou undefined.",
      );
    }

    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(BYTE_RANGE_REGEX);

    if (!byteRangeMatch) {
      throw new Error("ByteRange sumiu na hora de injetar a assinatura.");
    }

    const signatureStart = byteRangeMatch.slice(1).map(Number)[1] + 1;
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2] - 1;
    const reservedSpaceSize = signatureEnd - signatureStart;

    console.log(
      `[PdfService] 8. Preenchendo espaço reservado (Tamanho: ${reservedSpaceSize})...`,
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

    console.log("[PdfService] 9. PDF Finalizado e pronto para entrega!");
    return finalPdfBuffer;
  }
}

module.exports = PdfService;
