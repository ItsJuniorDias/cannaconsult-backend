// signer.js
const forge = require("node-forge");

class CustomSigner {
  /**
   * @param {string} pdfHash - O Hash SHA-256 do PDF (Base64)
   * @param {string} certificatePem - O certificado do médico em formato PEM
   */
  static prepareEnvelope(pdfHash, certificatePem) {
    // 1. Carrega o certificado do médico
    const cert = forge.pki.certificateFromPem(certificatePem);

    // 2. Cria o envelope SignedData
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(Buffer.from(pdfHash, "base64"));

    // 3. Adiciona o signatário (médico)
    p7.addSigner({
      key: null, // Não temos a chave privada, a BirdID que tem!
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        {
          type: forge.pki.oids.contentType,
          value: forge.pki.oids.data,
        },
        {
          type: forge.pki.oids.messageDigest,
          // O node-forge calcula o digest do conteúdo automaticamente aqui
        },
        {
          type: forge.pki.oids.signingTime,
          value: new Date(),
        },
      ],
    });

    // 4. A mágica: Recuperamos os "Authenticated Attributes" para a BirdID assinar
    // O PDF exige que a assinatura RSA seja feita sobre o HASH dos atributos, não do PDF direto.
    const signer = p7.signers[0];
    const attrs = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      signer.authenticatedAttributes,
    );

    const bytesToSign = forge.asn1.toDer(attrs).getBytes();
    const hashToSignBirdID = forge.md.sha256
      .create()
      .update(bytesToSign)
      .digest()
      .toHex();

    return {
      p7,
      hashToSignBirdID: Buffer.from(hashToSignBirdID, "hex").toString("base64"),
    };
  }

  /**
   * Finaliza o envelope colando a resposta da BirdID dentro dele
   */
  static finishEnvelope(p7, signatureFromBirdID) {
    const signatureBytes = forge.util.decode64(signatureFromBirdID);
    p7.signers[0].addSignature(signatureBytes);

    // Converte o envelope completo para DER (formato binário que o PDF ama)
    const derBuffer = forge.asn1.toDer(forge.pkcs7.toAsn1(p7)).getBytes();
    return Buffer.from(derBuffer, "binary").toString("hex");
  }
}

module.exports = CustomSigner;
