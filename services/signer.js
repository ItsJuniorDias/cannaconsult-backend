// services/signer.js
const forge = require("node-forge");

// Chave privada de mentira (1024 bits) APENAS para enganar o node-forge e forçá-lo
// a construir a estrutura ASN.1 do PDF. A assinatura gerada por ela será descartada.
const DUMMY_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIICXAIBAAKBgQC7Z+p1/KzKx0F/t+4... (chave truncada para exemplo, mas o node-forge aceita chaves geradas na hora)
-----END RSA PRIVATE KEY-----`;

class CustomSigner {
  static prepareEnvelope(documentBuffer, certificatePem) {
    // 1. Gera uma chave temporária rápida apenas para a estrutura
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.certificateFromPem(certificatePem);

    // 2. Inicia o envelope PKCS#7 / CMS
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(documentBuffer.toString("binary"));

    // 3. Adiciona o assinante usando o certificado REAL e a chave FALSA
    p7.addSigner({
      key: keys.privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest }, // O forge preenche automaticamente
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });

    // 4. Manda assinar (Gera a estrutura e os atributos autenticados)
    p7.sign({ detached: true });

    // 5. Extrai a camada de atributos que realmente precisa ser enviada para a BirdID
    const signer = p7.signers[0];
    const authAttrsAsn1 = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      signer.authenticatedAttributes,
    );

    // 6. Calcula o Hash SHA-256 desses atributos
    const authAttrsDer = forge.asn1.toDer(authAttrsAsn1).getBytes();
    const hashToSign = forge.md.sha256
      .create()
      .update(authAttrsDer)
      .digest()
      .toHex();

    return {
      p7,
      hashToSignBirdID: Buffer.from(hashToSign, "hex").toString("base64"),
    };
  }

  static finishEnvelope(p7, rawBirdIdSignatureBase64) {
    // 7. O Pulo do Gato: Arranca a assinatura falsa e cola a RAW real da Soluti
    p7.signers[0].signature = forge.util.decode64(rawBirdIdSignatureBase64);

    // 8. Transforma o envelope completo e finalizado em Hexadecimal
    const asn1 = forge.pkcs7.toAsn1(p7);
    const der = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(der, "binary").toString("hex");
  }
}

module.exports = CustomSigner;
