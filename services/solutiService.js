// solutiService.js (Versão Produção)
const axios = require("axios");

class SolutiService {
  static async getAccessToken(authCode, codeVerifier) {
    try {
      // O padrão OAuth 2.0 exige o formato URL Encoded para a rota de token
      const params = new URLSearchParams();
      params.append("grant_type", "authorization_code");
      params.append("code", authCode);
      params.append("client_id", process.env.SOLUTI_CLIENT_ID);
      params.append("client_secret", process.env.SOLUTI_CLIENT_SECRET);
      params.append("redirect_uri", process.env.SOLUTI_REDIRECT_URI);

      // Adicionando o verificador PKCE que veio do frontend
      params.append("code_verifier", codeVerifier);

      // ATENÇÃO: A rota correta para resgatar o token é /oauth/token (e não /authorize)
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
      console.error(
        "[Soluti] Erro no OAuth:",
        error.response?.data || error.message,
      );
      throw new Error(
        "Falha de comunicação com o provedor de identidade (Soluti).",
      );
    }
  }

  static async signHash(hashBase64, accessToken) {
    try {
      const response = await axios.post(
        `${process.env.SOLUTI_API_URL}/sign`,
        {
          hash_algorithm: "SHA256",
          hash: hashBase64,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // Timeout de 10s para não prender a requisição
        },
      );
      return response.data.signature;
    } catch (error) {
      console.error(
        "[Soluti] Erro na Assinatura:",
        error.response?.data || error.message,
      );
      throw new Error(
        "A autoridade certificadora recusou a assinatura. Verifique o token ou os créditos.",
      );
    }
  }
}

module.exports = SolutiService;
