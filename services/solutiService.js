// solutiService.js (Versão Corrigida para BirdID Nativo)
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

  // A sua controller passava o 'otp' como 3º parâmetro,
  // adicionei ele aqui caso você precise para os logs,
  // mas o token OAuth (se gerado via front) já costuma estar autorizado.
  static async signHash(hashBase64, accessToken, otp = null) {
    try {
      console.log(
        "[Soluti] Enviando Hash para a BirdID (Solicitando PKCS7)...",
      );

      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          hashes: [
            {
              id: "1",
              alias: "Documento Medico",
              hash: hashBase64,
              hash_algorithm: "2.16.840.1.101.3.4.2.1",
              signature_format: "PKCS7", // 🔴 MUDANÇA CRÍTICA AQUI!
              include_chain: true,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        },
      );

      if (
        response.data &&
        response.data.signatures &&
        response.data.signatures.length > 0
      ) {
        const assinatura = response.data.signatures[0];
        let assinaturaBase64 = null;

        if (typeof assinatura === "string") {
          assinaturaBase64 = assinatura;
        } else if (typeof assinatura === "object") {
          // Agora ele vai caçar o formato PKCS7 ou RAW
          assinaturaBase64 =
            assinatura.pkcs7 ||
            assinatura.signature ||
            assinatura.raw_signature ||
            assinatura.signed_hash;
        }

        if (!assinaturaBase64) {
          throw new Error(
            "Estrutura não reconhecida pela extração: " +
              JSON.stringify(assinatura),
          );
        }

        console.log("[Soluti] ✅ Base64 PKCS7 gerado com sucesso!");
        return assinaturaBase64;
      } else {
        throw new Error(
          "A BirdID retornou sucesso, mas o array de assinaturas veio vazio.",
        );
      }
    } catch (error) {
      console.error("[Soluti] ❌ Erro:", error.response?.data || error.message);
      throw new Error(`Falha na assinatura.`);
    }
  }
}

module.exports = SolutiService;
