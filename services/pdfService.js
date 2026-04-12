// pdfService.js (Versão Definitiva - Pure Buffer)
const { PDFDocument } = require("pdf-lib");
const crypto = require("crypto");

class PdfService {
  static async preparePdf(pdfBuffer) {
    console.log("[PdfService] 1. Carregando PDF...");
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Pega a última página
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

    // 1. Encontra a posição do placeholder /ByteRange original
    const byteRangeStart = finalBuffer.lastIndexOf(Buffer.from("/ByteRange"));
    const byteRangeEnd = finalBuffer.indexOf("]", byteRangeStart) + 1;
    const originalByteRangeLength = byteRangeEnd - byteRangeStart;

    // 2. Encontra a fresta exata da assinatura (os zeros dentro do < >)
    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = finalBuffer.lastIndexOf(contentsTag);
    if (contentsPos === -1)
      throw new Error("Não foi possível encontrar a tag /Contents.");

    const signatureStart = contentsPos + contentsTag.length; // Exatamente no primeiro '0' após o '<'
    const signatureEnd = finalBuffer.indexOf(">", signatureStart); // Exatamente no '>'

    // 3. Calcula o ByteRange matematicamente perfeito
    const length1 = signatureStart;
    const start2 = signatureEnd + 1;
    const length2 = finalBuffer.length - start2;

    let realByteRange = `/ByteRange [0 ${length1} ${start2} ${length2}]`;

    // Preenche com espaços vazios para não alterar o tamanho do arquivo
    realByteRange = realByteRange.padEnd(originalByteRangeLength, " ");

    // 4. Escreve o ByteRange corrigido DIRETAMENTE na memória
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
    const signatureStart = contentsPos + contentsTag.length;
    const signatureEnd = buffer.indexOf(">", signatureStart);

    // Corta o arquivo cirurgicamente (deixando o recheio de zeros de fora)
    const part1 = buffer.subarray(0, signatureStart);
    const part2 = buffer.subarray(signatureEnd + 1);

    const documentToHash = Buffer.concat([part1, part2]);
    return crypto.createHash("sha256").update(documentToHash).digest("base64");
  }

  static injectSignature(buffer, signatureBase64) {
    const signatureHex = Buffer.from(signatureBase64, "base64").toString("hex");

    const contentsTag = Buffer.from("/Contents <");
    const contentsPos = buffer.lastIndexOf(contentsTag);
    const signatureStart = contentsPos + contentsTag.length;
    const signatureEnd = buffer.indexOf(">", signatureStart);

    const availableSpace = signatureEnd - signatureStart;

    if (signatureHex.length > availableSpace) {
      throw new Error(
        `Assinatura PKCS7 (${signatureHex.length} bytes) estourou o limite de ${availableSpace} bytes.`,
      );
    }

    // Preenche com zeros se a assinatura for menor que o buraco
    const paddedHex = signatureHex.padEnd(availableSpace, "0");

    // 🔴 INJEÇÃO MESTRA: Escreve o hexadecimal direto na memória original do PDF.
    // Nenhuma string, nenhum concat. O arquivo continua intocado estruturalmente.
    buffer.write(paddedHex, signatureStart, availableSpace, "ascii");

    return buffer;
  }
}

module.exports = PdfService;
