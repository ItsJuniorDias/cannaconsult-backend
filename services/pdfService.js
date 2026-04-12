// services/pdfService.js
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

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
      reason: "Assinatura Medica",
      contactInfo: "contato@cannaconsult.com.br",
      name: "Assinatura Digital BirdID",
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

    const hexStart = contentsPos + 11;
    const hexEnd = finalBuffer.indexOf(">", hexStart);

    const length1 = hexStart;
    const start2 = hexEnd;
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

  static calculateHashForSigning(buffer) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const hexStart = contentsPos + 11;
    const hexEnd = buffer.indexOf(">", hexStart);

    const part1 = buffer.subarray(0, hexStart);
    const part2 = buffer.subarray(hexEnd);

    const documentToHash = Buffer.concat([part1, part2]);
    return crypto.createHash("sha256").update(documentToHash).digest("base64");
  }

  static injectSignature(buffer, signatureBase64) {
    // 🔴 LIMPEZA DE SEGURANÇA: Remove formatos PEM e quebras de linha que corrompem o PDF
    const cleanB64 = signatureBase64
      .replace(/-----(BEGIN|END)[^-]+-----/g, "")
      .replace(/[\r\n\t ]/g, "");

    const signatureHex = Buffer.from(cleanB64, "base64").toString("hex");

    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const hexStart = contentsPos + 11;
    const hexEnd = buffer.indexOf(">", hexStart);

    const availableSpace = hexEnd - hexStart;

    if (signatureHex.length > availableSpace) {
      throw new Error(`Assinatura estourou o limite de bytes.`);
    }

    const paddedHex = signatureHex.padEnd(availableSpace, "0");
    buffer.write(paddedHex, hexStart, availableSpace, "ascii");

    return buffer;
  }
}

module.exports = PdfService;
