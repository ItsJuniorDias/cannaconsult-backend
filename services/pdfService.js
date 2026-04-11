// pdfService.js (Versão Produção)
const { plainAddPlaceholder } = require("@signpdf/placeholder-plain");
const crypto = require("crypto");

class PdfService {
  // 1. Prepara o PDF com o espaço para a assinatura padrão PAdES
  static preparePdf(pdfBuffer) {
    // Define o tamanho da assinatura (8192 bytes é padrão seguro para RSA 2048/4096)
    const signatureLength = 8192;

    // plainAddPlaceholder cria o dicionário de assinatura e o ByteRange correto
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer,
      reason: "Assinatura Digital BirdID",
      signatureLength: signatureLength,
    });

    return pdfWithPlaceholder;
  }

  // 2. Extrai exatamente o que precisa ser "hasheado"
  static calculateHashForSigning(pdfWithPlaceholderBuffer) {
    // O Adobe Acrobat lê o ByteRange: [inicio1, tamanho1, inicio2, tamanho2]
    // Precisamos pegar o documento inteiro, exceto o "buraco" onde vai a assinatura
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");

    const byteRangeMatch = pdfString.match(
      /\/ByteRange\s*\[(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]/,
    );
    if (!byteRangeMatch)
      throw new Error("Não foi possível encontrar o ByteRange no PDF");

    const byteRange = byteRangeMatch.slice(1).map(Number);

    // Pega a primeira e a segunda parte do PDF em volta do placeholder
    const part1 = pdfWithPlaceholderBuffer.subarray(
      byteRange[0],
      byteRange[0] + byteRange[1],
    );
    const part2 = pdfWithPlaceholderBuffer.subarray(
      byteRange[2],
      byteRange[2] + byteRange[3],
    );

    // Junta as partes e gera o Hash SHA-256
    const documentToHash = Buffer.concat([part1, part2]);
    const hash = crypto
      .createHash("sha256")
      .update(documentToHash)
      .digest("base64");

    return hash;
  }

  // 3. Injeta a assinatura de volta no local exato
  static injectSignature(pdfWithPlaceholderBuffer, signatureBase64) {
    // Converte a assinatura recebida (PKCS#7) em Hexadecimal
    const signatureBuffer = Buffer.from(signatureBase64, "base64");
    let signatureHex = signatureBuffer.toString("hex");

    // Pega o tamanho original reservado (precisamos preencher todo o espaço)
    const pdfString = pdfWithPlaceholderBuffer.toString("binary");
    const byteRangeMatch = pdfString.match(
      /\/ByteRange\s*\[(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]/,
    );
    const signatureStart = byteRangeMatch.slice(1).map(Number)[1] + 1; // +1 para pular o "<"
    const signatureEnd = byteRangeMatch.slice(1).map(Number)[2] - 1; // -1 para parar antes do ">"

    const reservedSpaceSize = signatureEnd - signatureStart;

    // Completa o resto do espaço reservado com zeros (padding padrão PDF)
    signatureHex = signatureHex.padEnd(reservedSpaceSize, "0");

    if (signatureHex.length > reservedSpaceSize) {
      throw new Error(
        "Assinatura retornada é maior que o espaço reservado no PDF.",
      );
    }

    // Substitui os zeros do placeholder pela assinatura real
    const finalPdfBuffer = Buffer.concat([
      pdfWithPlaceholderBuffer.subarray(0, signatureStart),
      Buffer.from(signatureHex, "binary"),
      pdfWithPlaceholderBuffer.subarray(signatureEnd),
    ]);

    return finalPdfBuffer;
  }
}

module.exports = PdfService;
