// services/signer.js
const forge = require("node-forge");

class CustomSigner {
  static prepareEnvelope(documentBufferToHash, certificatePem) {
    // 1. Gera chave temporária rápida
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.certificateFromPem(certificatePem);

    // 2. Inicia o envelope PAdES
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(
      documentBufferToHash.toString("binary"),
      "binary",
    );

    // 3. Adiciona assinante
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

    let hashToSignHex = null;

    // 🔴 O VERDADEIRO INTERCEPTADOR: Aplicado diretamente na instância da chave falsa!
    keys.privateKey.sign = function (md, scheme) {
      // Capturamos o hash perfeito gerado internamente pela biblioteca
      hashToSignHex = md.digest().toHex();

      // Retornamos 128 bytes nulos (binário seguro) só para ele fechar a estrutura em paz
      return "\x00".repeat(128);
    };

    // 4. Manda assinar (Isso vai engatilhar a função logo acima)
    p7.sign({ detached: true });

    // Se o espião não funcionou, nós paramos o processo aqui mesmo
    if (!hashToSignHex) {
      throw new Error("Falha ao interceptar o hash dos atributos.");
    }

    return {
      p7,
      hashToSignBirdID: Buffer.from(hashToSignHex, "hex").toString("base64"),
    };
  }

  static finishEnvelope(p7, rawBirdIdSignatureBase64) {
    // 5. Arrancamos a assinatura de zeros e colamos a criptografia REAL da Soluti
    p7.signers[0].signature = forge.util.decode64(rawBirdIdSignatureBase64);

    // 6. Transforma o envelope completo e finalizado em Hexadecimal
    const asn1 = forge.pkcs7.toAsn1(p7);
    const der = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(der, "binary").toString("hex");
  }
}

module.exports = CustomSigner;
