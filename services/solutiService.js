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
  static async signHash(hashDosAtributos, accessToken) {
    try {
      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          hashes: [
            {
              id: "1",
              hash: hashDosAtributos,
              hash_algorithm: "2.16.840.1.101.3.4.2.1",
              signature_format: "RAW", // 🔴 CRÍTICO: Agora pedimos RAW!
            },
          ],
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const sig = response.data.signatures[0];
      const assinaturaRaw = sig.raw_signature || sig.signature;

      // Limpa possíveis lixos do Base64
      return assinaturaRaw.replace(/[\r\n\t ]/g, "");
    } catch (error) {
      throw new Error("Falha na API da BirdID.");
    }
  }

  // Adicione este método dentro da classe SolutiService
  static async getCertificate(accessToken) {
    try {
      // Bate na rota oficial de certificados
      const response = await axios.get(
        `${process.env.SOLUTI_OAUTH_URL}/v0/certificates`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      // Procura em arrays ou strings diretas
      let certPEM = null;
      if (response.data.certificates && response.data.certificates.length > 0) {
        certPEM =
          response.data.certificates[0].certificate ||
          response.data.certificates[0];
      } else if (response.data.certificate) {
        certPEM = response.data.certificate;
      }

      if (
        certPEM &&
        typeof certPEM === "string" &&
        certPEM.includes("BEGIN CERTIFICATE")
      ) {
        return certPEM;
      } else {
        console.log(
          "[Soluti] ⚠️ Payload bruto retornado:",
          JSON.stringify(response.data, null, 2),
        );
        throw new Error("Não foi possível extrair o PEM do payload.");
      }
    } catch (error) {
      throw new Error(`Falha ao buscar certificado: ${error.message}`);
    }
  }
}

module.exports = SolutiService;
