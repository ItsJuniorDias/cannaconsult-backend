const axios = require("axios");

class SolutiService {
  // 🔐 OAuth Token
  static async getAccessToken(authCode, codeVerifier) {
    try {
      const params = new URLSearchParams();
      params.append("grant_type", "authorization_code");
      params.append("code", authCode);
      params.append("client_id", process.env.SOLUTI_CLIENT_ID);
      params.append("client_secret", process.env.SOLUTI_CLIENT_SECRET);
      params.append("redirect_uri", process.env.SOLUTI_REDIRECT_URI);
      params.append("code_verifier", codeVerifier);

      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/token`,
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 15000,
        },
      );

      if (!response.data?.access_token) {
        throw new Error("Access token não retornado pela Soluti");
      }

      return response.data.access_token;
    } catch (error) {
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error("[Soluti] ❌ Erro no OAuth:", detalheErro);

      throw new Error(`Falha OAuth Soluti: ${detalheErro}`);
    }
  }

  // ✍️ Assinatura do hash (CMS ICP-Brasil)
  static async signHash(hashBase64, accessToken) {
    try {
      if (!hashBase64 || typeof hashBase64 !== "string") {
        throw new Error("Hash inválido para assinatura");
      }

      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          hashes: [
            {
              id: "1",
              hash: hashBase64,

              // SHA-256 OID (correto)
              hash_algorithm: "2.16.840.1.101.3.4.2.1",

              // 🔴 ESSENCIAL
              signature_format: "CMS",

              // 🔴 ESSENCIAL (cadeia ICP-Brasil)
              include_chain: true,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        },
      );

      if (!response.data?.signatures?.length) {
        throw new Error("Resposta inválida da API de assinatura");
      }

      const sig = response.data.signatures[0];

      let signature =
        sig.signature || sig.cms || sig.pkcs7 || sig.raw_signature;

      if (!signature) {
        throw new Error("Nenhuma assinatura retornada pela Soluti");
      }

      // 🔴 LIMPEZA CRÍTICA
      signature = signature
        .replace(/-----(BEGIN|END)[^-]+-----/g, "")
        .replace(/[\r\n\t ]/g, "");

      if (!signature.match(/^[A-Za-z0-9+/=]+$/)) {
        throw new Error("Assinatura retornada não é base64 válida");
      }

      return signature;
    } catch (error) {
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error("[Soluti] ❌ Erro ao assinar hash:", detalheErro);

      throw new Error(`Falha na assinatura BirdID: ${detalheErro}`);
    }
  }

  // 📜 Certificado do usuário (opcional para debug/validação)
  static async getCertificate(accessToken) {
    try {
      const response = await axios.get(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/certificate-discovery`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          timeout: 15000,
        },
      );

      if (
        response.data?.certificates &&
        response.data.certificates.length > 0
      ) {
        const certPEM = response.data.certificates[0].certificate;

        if (certPEM && certPEM.includes("BEGIN CERTIFICATE")) {
          return certPEM;
        }
      }

      console.warn(
        "[Soluti] ⚠️ Certificado não encontrado:",
        JSON.stringify(response.data, null, 2),
      );

      throw new Error("Certificado não encontrado na resposta");
    } catch (error) {
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error("[Soluti] ❌ Erro ao buscar certificado:", detalheErro);

      throw new Error(`Falha ao buscar certificado: ${detalheErro}`);
    }
  }
}

module.exports = SolutiService;
