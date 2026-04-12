// services/pdfService.js
const { PDFDocument } = require("pdf-lib");

const BYTE_RANGE_REGEX =
  /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/;

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

    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = finalBuffer.lastIndexOf(contentsTag);

    const signatureStart = contentsPos + contentsTag.length;
    const signatureEnd = finalBuffer.indexOf(">", signatureStart);

    const length1 = signatureStart;
    const start2 = signatureEnd + 1;
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

  // Devolve o Buffer cortado para o node-forge montar a estrutura
  static getDocumentBufferToHash(buffer) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const signatureStart = contentsPos + contentsTag.length;
    const signatureEnd = buffer.indexOf(">", signatureStart);

    const part1 = buffer.subarray(0, signatureStart);
    const part2 = buffer.subarray(signatureEnd + 1);

    return Buffer.concat([part1, part2]);
  }

  static injectSignature(buffer, signatureHex) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const signatureStart = contentsPos + contentsTag.length;
    const signatureEnd = buffer.indexOf(">", signatureStart);

    const availableSpace = signatureEnd - signatureStart;

    if (signatureHex.length > availableSpace) {
      throw new Error(
        `Assinatura estourou o limite de ${availableSpace} bytes.`,
      );
    }

    const paddedHex = signatureHex.padEnd(availableSpace, "0");
    buffer.write(paddedHex, signatureStart, availableSpace, "ascii");

    return buffer;
  }
}

module.exports = PdfService;
