// services/signer.js
const forge = require("node-forge");

class CustomSigner {
  static prepareEnvelope(documentBuffer, certificatePem) {
    // 1. Gera uma chave temporária rápida (Demora 10ms)
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.certificateFromPem(certificatePem);

    // 2. Inicia o envelope PKCS#7
    const p7 = forge.pkcs7.createSignedData();

    // 🔴 CORREÇÃO 1: Passamos o parâmetro 'binary' explícito.
    // Isso impede o node-forge de tentar ler o PDF como texto e anula o URIError!
    p7.content = forge.util.createBuffer(
      documentBuffer.toString("binary"),
      "binary",
    );

    // 3. Adiciona os atributos obrigatórios
    p7.addSigner({
      key: keys.privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest }, // O node-forge vai preencher isso
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });

    // 🔴 CORREÇÃO 2: O Interceptador (Monkey-Patch)
    let hashToSignHex = null;

    // Guardamos a função original de assinatura do node-forge
    const originalSign = forge.pki.rsa.sign;

    // Sobrescrevemos a função temporariamente com o nosso "Espião"
    forge.pki.rsa.sign = function (privateKey, md, scheme) {
      // ROUBAMOS O HASH! O parâmetro 'md' contém o hash exato e perfeito dos atributos.
      hashToSignHex = md.digest().toHex();

      // Retornamos uma assinatura falsa cheia de zeros só para ele terminar a estrutura sem dar erro
      return String.fromCharCode.apply(null, new Uint8Array(128));
    };

    // 4. Mandamos ele montar a estrutura (isso vai acionar o nosso espião acima)
    p7.sign({ detached: true });

    // 5. Devolvemos a função original para o node-forge para não quebrar o resto do sistema
    forge.pki.rsa.sign = originalSign;

    if (!hashToSignHex) {
      throw new Error("Falha ao interceptar o hash dos atributos.");
    }

    return {
      p7,
      hashToSignBirdID: Buffer.from(hashToSignHex, "hex").toString("base64"),
    };
  }

  static finishEnvelope(p7, rawBirdIdSignatureBase64) {
    // 6. Arrancamos a assinatura de zeros e colamos a criptografia REAL da Soluti
    p7.signers[0].signature = forge.util.decode64(rawBirdIdSignatureBase64);

    // 7. Transforma o envelope completo e finalizado em Hexadecimal
    const asn1 = forge.pkcs7.toAsn1(p7);
    const der = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(der, "binary").toString("hex");
  }
}

module.exports = CustomSigner;
