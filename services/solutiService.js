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
  static async signHash(hashToSign, accessToken) {
    try {
      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          hashes: [
            {
              id: "1",
              hash: hashToSign, // O hash dos atributos que o Signer gerou
              hash_algorithm: "2.16.840.1.101.3.4.2.1",
              signature_format: "RAW", // Pedimos apenas o carimbo RSA cru
            },
          ],
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const sig = response.data.signatures[0];
      return sig.raw_signature || sig.signature;
    } catch (error) {
      throw new Error("Erro na BirdID.");
    }
  }

  // Adicione este método dentro da classe SolutiService
  static async getCertificate(accessToken) {
    try {
      console.log("[Soluti] Buscando informações e certificado do usuário...");

      // 🔴 ROTA CORRIGIDA: O padrão OAuth2 para dados do usuário é /userinfo
      const response = await axios.get(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/userinfo`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      // Vamos procurar o certificado nas propriedades mais comuns do VaultID
      const certPEM =
        response.data.certificate ||
        response.data.certificate_pem ||
        response.data.cert ||
        (response.data.certificates && response.data.certificates[0]);

      if (certPEM) {
        console.log("[Soluti] ✅ Certificado PEM resgatado com sucesso!");
        return certPEM;
      } else {
        // Se a Soluti mudou o nome da variável, isso aqui vai nos mostrar exatamente qual é!
        console.log(
          "[Soluti] ⚠️ Payload do UserInfo:",
          JSON.stringify(response.data, null, 2),
        );
        throw new Error(
          "O certificado não foi encontrado nas propriedades mapeadas do userinfo.",
        );
      }
    } catch (error) {
      console.error(
        "[Soluti] ❌ Erro ao buscar certificado:",
        error.response?.data || error.message,
      );

      // Se der 404 de novo, vamos tentar a rota alternativa /v0/certificate (sem o oauth)
      throw new Error("Falha ao buscar o certificado do usuário na BirdID.");
    }
  }
}

module.exports = SolutiService;
