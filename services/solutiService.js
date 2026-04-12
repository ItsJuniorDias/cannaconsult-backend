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
      console.log("[Soluti] Enviando Hash para a BirdID...");

      // A ROTA CORRETA É: /v0/oauth/signature
      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/v0/oauth/signature`,
        {
          // A BirdID exige um array de hashes e o OID do algoritmo
          hashes: [
            {
              id: "1",
              alias: "Documento Medico",
              hash: hashBase64,
              hash_algorithm: "2.16.840.1.101.3.4.2.1", // OID obrigatório para SHA-256
              signature_format: "RAW", // Mantém RAW porque a injeção PKCS#7 é feita por nós no Node
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

      // A BirdID devolve a resposta também em formato de array.
      // Retornamos apenas a string Base64 da assinatura gerada.
      if (
        response.data &&
        response.data.signatures &&
        response.data.signatures.length > 0
      ) {
        console.log("[Soluti] ✅ Assinatura autorizada com sucesso!");

        // A API da BirdID pode retornar o array de strings direto ou um array de objetos.
        // Tratamos os dois cenários:
        const assinatura = response.data.signatures[0];
        return typeof assinatura === "string"
          ? assinatura
          : assinatura.signature;
      } else {
        throw new Error("A BirdID não retornou a assinatura.");
      }
    } catch (error) {
      console.error(
        "[Soluti] ❌ Erro na Assinatura (Status):",
        error.response?.status,
      );
      console.error(
        "[Soluti] ❌ Detalhes da Recusa:",
        JSON.stringify(error.response?.data, null, 2) || error.message,
      );

      throw new Error(
        `A autoridade certificadora recusou a assinatura. Erro: ${error.response?.data?.error_description || "Verifique o token ou os créditos."}`,
      );
    }
  }
}

module.exports = SolutiService;
