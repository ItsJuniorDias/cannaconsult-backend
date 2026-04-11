// solutiService.js (Versão Produção)
const axios = require("axios");

class SolutiService {
  static async getAccessToken(authCode) {
    try {
      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/authorize`,
        {
          grant_type: "authorization_code",
          code: authCode,
          client_id: process.env.SOLUTI_CLIENT_ID,
          client_secret: process.env.SOLUTI_CLIENT_SECRET,
          redirect_uri: process.env.SOLUTI_REDIRECT_URI,
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
