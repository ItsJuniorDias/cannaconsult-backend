// services/signer.js
const forge = require("node-forge");

class CustomSigner {
  static prepareEnvelope(documentBufferToHash, certificatePem) {
    const cert = forge.pki.certificateFromPem(certificatePem);

    // 1. Calcula o tamanho exato da assinatura que a Soluti vai devolver (Ex: 2048 bits = 256 bytes)
    const keySizeBits = cert.publicKey.n.bitLength();
    const expectedSignatureLength = Math.ceil(keySizeBits / 8);

    // Gera uma chave temporária bem rápida só para passar pela validação da lib
    const keys = forge.pki.rsa.generateKeyPair(512);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(
      documentBufferToHash.toString("binary"),
      "binary",
    );

    // 🔴 O SEGREDO DO ADOBE: Anexar o certificado oficial dentro do envelope!
    p7.addCertificate(cert);

    p7.addSigner({
      key: keys.privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });

    let hashToSignHex = null;

    // O Espião Inteligente (Agora com o tamanho dinâmico e perfeito)
    keys.privateKey.sign = function (md, scheme) {
      hashToSignHex = md.digest().toHex();

      // Retorna os zeros com o tamanho MILIMETRICAMENTE exato da assinatura final
      return "\x00".repeat(expectedSignatureLength);
    };

    p7.sign({ detached: true });

    if (!hashToSignHex) {
      throw new Error("Falha ao interceptar o hash dos atributos.");
    }

    return {
      p7,
      hashToSignBirdID: Buffer.from(hashToSignHex, "hex").toString("base64"),
    };
  }

  static finishEnvelope(p7, rawBirdIdSignatureBase64) {
    p7.signers[0].signature = forge.util.decode64(rawBirdIdSignatureBase64);

    const asn1 = p7.toAsn1();
    const der = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(der, "binary").toString("hex");
  }
}

module.exports = CustomSigner;
