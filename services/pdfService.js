// services/pdfService.js
const { PDFDocument } = require("pdf-lib");

class PdfService {
  static async preparePdf(pdfBuffer) {
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
      contactInfo: "contato@cannaconsult.com.br",
      name: "Assinatura Digital",
      location: "Brasil",
      signatureLength: 16384,
      widgetRect: [50, 50, 250, 100],
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    let finalBuffer = Buffer.from(pdfBytes);

    const byteRangeStart = finalBuffer.lastIndexOf(Buffer.from("/ByteRange"));
    const byteRangeEnd = finalBuffer.indexOf("]", byteRangeStart) + 1;
    const originalByteRangeLength = byteRangeEnd - byteRangeStart;

    // 🔴 A MATEMÁTICA SIMÉTRICA: A fresta agora engloba EXATAMENTE do '<' ao '>'
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = finalBuffer.lastIndexOf(contentsTag);

    const signatureGapStart = contentsPos + 10; // Aponta EXATAMENTE para o '<'
    const signatureGapEnd = finalBuffer.indexOf(">", signatureGapStart) + 1; // Aponta EXATAMENTE para logo após o '>'

    const length1 = signatureGapStart;
    const start2 = signatureGapEnd;
    const length2 = finalBuffer.length - start2;

    let realByteRange = `/ByteRange [0 ${length1} ${start2} ${length2}]`;
    realByteRange = realByteRange.padEnd(originalByteRangeLength, " ");

    finalBuffer.write(
      realByteRange,
      byteRangeStart,
      originalByteRangeLength,
      "ascii",
    );
    return finalBuffer;
  }

  // Extrai o buffer do PDF ignorando totalmente a fresta (sem o < e sem o >)
  static getDocumentBufferToHash(buffer) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const signatureGapStart = contentsPos + 10;
    const signatureGapEnd = buffer.indexOf(">", signatureGapStart) + 1;

    const part1 = buffer.subarray(0, signatureGapStart);
    const part2 = buffer.subarray(signatureGapEnd);

    return Buffer.concat([part1, part2]);
  }

  static injectSignature(buffer, signatureHex) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const signatureGapStart = contentsPos + 10;
    const signatureGapEnd = buffer.indexOf(">", signatureGapStart) + 1;

    // O espaço disponível para os números é o tamanho da fresta menos os símbolos < e >
    const availableSpace = signatureGapEnd - signatureGapStart - 2;

    if (signatureHex.length > availableSpace) {
      throw new Error(
        `Assinatura estourou o limite de ${availableSpace} bytes.`,
      );
    }

    const paddedHex = signatureHex.padEnd(availableSpace, "0");

    // 🔴 O TOQUE DE MESTRE: Reescrevemos o < e o > ao redor do código Hexadecimal
    buffer.write(
      `<${paddedHex}>`,
      signatureGapStart,
      availableSpace + 2,
      "ascii",
    );

    return buffer;
  }
}

module.exports = PdfService;
