// solutiService.js (Versão Final com Limpeza de Base64)
const axios = require("axios");

class SolutiService {
  static async getAccessToken(authCode, codeVerifier) {
    try {
      const params = new URLSearchParams();
      params.append("grant_type", "authorization_code");
      params.append("code", authCode);
      params.append("client_id", process.env.SOLUTI_CLIENT_ID);
      params.append("client_secret", process.env.SOLUTI_CLIENT_SECRET);
      params.append("redirect_uri", process.env.SOLUTI_REDIRECT_URI);
      params.append("code_verifier", codeVerifier);

      // REMOVIDO: O scope não deve vir no corpo do POST da troca de token.

      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/token`,
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      return response.data.access_token;
    } catch (error) {
      // Pega o erro real da Soluti
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error("[Soluti] Erro no OAuth:", detalheErro);

      // Repassa o erro real para o Frontend para facilitar sua vida
      throw new Error(`Falha OAuth Soluti: ${detalheErro}`);
    }
  }

  // solutiService.js (Trecho atualizado)
  static async signHash(hashBase64, accessToken) {
    try {
      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          hashes: [
            {
              id: "1",
              hash: hashBase64,
              hash_algorithm: "2.16.840.1.101.3.4.2.1",
              signature_format: "CMS", // 🔴 A MÁGICA: A BirdID monta o envelope completo!
              include_chain: true, // 🔴 Inclui a cadeia ICP-Brasil
            },
          ],
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const sig = response.data.signatures[0];
      // Pega o envelope Base64 retornado
      return sig.signature || sig.pkcs7 || sig.cms || sig.raw_signature;
    } catch (error) {
      throw new Error("Falha na API da BirdID.");
    }
  }

  // Adicione este método dentro da classe SolutiService
  static async getCertificate(accessToken) {
    try {
      console.log(
        "[Soluti] Buscando certificado na rota oficial /v0/oauth/certificate-discovery...",
      );

      // 🔴 ROTA OFICIAL E DOCUMENTADA
      const response = await axios.get(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/certificate-discovery`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      // Extrai o certificado do array que a API devolve
      if (
        response.data &&
        response.data.certificates &&
        response.data.certificates.length > 0
      ) {
        const certPEM = response.data.certificates[0].certificate;

        if (certPEM && certPEM.includes("BEGIN CERTIFICATE")) {
          console.log("[Soluti] ✅ Certificado PEM resgatado com sucesso!");
          return certPEM;
        }
      }

      // Se chegar aqui, algo veio estranho. Vamos logar.
      console.log(
        "[Soluti] ⚠️ Payload bruto retornado:",
        JSON.stringify(response.data, null, 2),
      );
      throw new Error(
        "A API respondeu, mas não encontrou o texto do certificado.",
      );
    } catch (error) {
      console.error(
        "[Soluti] ❌ Erro ao buscar certificado:",
        error.response?.data || error.message,
      );
      throw new Error(`Falha ao buscar o certificado: ${error.message}`);
    }
  }
}

module.exports = SolutiService;
