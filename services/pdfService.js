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
      reason: "Assinatura Medica",
      contactInfo: "contato@cannaconsult.com.br",
      name: "Dr(a). Medico Responsavel",
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

    // 🔴 A CORREÇÃO DE 1 BYTE: O corte agora é +11.
    // Ele aponta EXATAMENTE para o primeiro "0", deixando o "<" em segurança.
    const hexStart = contentsPos + 11;
    const hexEnd = finalBuffer.indexOf(">", hexStart); // Aponta para o ">"

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

  // Extrai o buffer do PDF mantendo o < e o > dentro do Hash perfeitamente
  static getDocumentBufferToHash(buffer) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const hexStart = contentsPos + 11;
    const hexEnd = buffer.indexOf(">", hexStart);

    const part1 = buffer.subarray(0, hexStart); // Inclui tudo até o "<"
    const part2 = buffer.subarray(hexEnd); // Inclui tudo a partir do ">"

    return Buffer.concat([part1, part2]);
  }

  static injectSignature(buffer, signatureHex) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const hexStart = contentsPos + 11;
    const hexEnd = buffer.indexOf(">", hexStart);

    // O espaço para os números é puramente a distância entre os caracteres < e >
    const availableSpace = hexEnd - hexStart;

    if (signatureHex.length > availableSpace) {
      throw new Error(
        `Assinatura estourou o limite de ${availableSpace} bytes.`,
      );
    }

    const paddedHex = signatureHex.padEnd(availableSpace, "0");

    // 🔴 INJEÇÃO CIRÚRGICA: Nós sobrescrevemos APENAS os zeros.
    // O < e o > originais do arquivo nunca são tocados ou removidos.
    buffer.write(paddedHex, hexStart, availableSpace, "ascii");

    return buffer;
  }
}

module.exports = PdfService;
