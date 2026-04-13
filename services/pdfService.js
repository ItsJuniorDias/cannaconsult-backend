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
      pdfDoc,
      page: lastPage,
      reason: "Assinatura Medica",
      contactInfo: "contato@cannaconsult.com.br",
      name: "Assinatura Digital BirdID",
      location: "Brasil",

      // 🔴 AUMENTADO para suportar CMS + cadeia ICP-Brasil
      signatureLength: 32768,

      widgetRect: [50, 50, 250, 100],
    });

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const buffer = Buffer.from(pdfBytes);

    // 🔍 Localiza /ByteRange
    const byteRangePos = buffer.lastIndexOf(Buffer.from("/ByteRange"));
    const byteRangeEnd = buffer.indexOf("]", byteRangePos) + 1;
    const byteRangeLength = byteRangeEnd - byteRangePos;

    // 🔍 Localiza /Contents
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);

    if (contentsPos === -1) {
      throw new Error("Não encontrou /Contents no PDF");
    }

    const hexStart = contentsPos + contentsTag.length;
    const hexEnd = buffer.indexOf(">", hexStart);

    if (hexEnd === -1) {
      throw new Error("Não encontrou o fim do /Contents");
    }

    // ✅ ByteRange CORRETO (excluindo <...>)
    const byteRange = [0, hexStart, hexEnd + 1, buffer.length - (hexEnd + 1)];

    let actualByteRange = `/ByteRange [${byteRange.join(" ")}]`;

    // mantém o mesmo tamanho do placeholder
    actualByteRange = actualByteRange.padEnd(byteRangeLength, " ");

    buffer.write(actualByteRange, byteRangePos, byteRangeLength, "ascii");

    return buffer;
  }

  static calculateHashForSigning(buffer) {
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);

    if (contentsPos === -1) {
      throw new Error("Não encontrou /Contents no PDF");
    }

    const hexStart = contentsPos + contentsTag.length;
    const hexEnd = buffer.indexOf(">", hexStart);

    if (hexEnd === -1) {
      throw new Error("Não encontrou fim do /Contents");
    }

    // ✅ REMOVE EXATAMENTE o conteúdo da assinatura
    const part1 = buffer.subarray(0, hexStart);
    const part2 = buffer.subarray(hexEnd + 1);

    const dataToHash = Buffer.concat([part1, part2]);

    return crypto.createHash("sha256").update(dataToHash).digest("base64");
  }

  static injectSignature(buffer, signatureBase64) {
    // 🔴 Limpeza forte do base64
    const cleanB64 = signatureBase64
      .replace(/-----(BEGIN|END)[^-]+-----/g, "")
      .replace(/[\r\n\t ]/g, "");

    if (!cleanB64.match(/^[A-Za-z0-9+/=]+$/)) {
      throw new Error("Assinatura inválida (base64 corrompido)");
    }

    const signatureHex = Buffer.from(cleanB64, "base64").toString("hex");

    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);

    if (contentsPos === -1) {
      throw new Error("Não encontrou /Contents no PDF");
    }

    const hexStart = contentsPos + contentsTag.length;
    const hexEnd = buffer.indexOf(">", hexStart);

    if (hexEnd === -1) {
      throw new Error("Não encontrou fim do /Contents");
    }

    const availableSpace = hexEnd - hexStart;

    if (signatureHex.length > availableSpace) {
      throw new Error(
        `Assinatura maior que o espaço disponível (${signatureHex.length} > ${availableSpace})`,
      );
    }

    // preenche com zeros (obrigatório no padrão PDF)
    const paddedSignature = signatureHex.padEnd(availableSpace, "0");

    buffer.write(paddedSignature, hexStart, availableSpace, "ascii");

    return buffer;
  }
}

module.exports = PdfService;
