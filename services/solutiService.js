const axios = require("axios");

class SolutiService {
  /**
   * 🚀 1. Autenticação (gera token + VCSchema)
   */
  static async getAcessToken(cpf, otp) {
    try {
      const cpfFormatado = cpf.replace(/\D/g, "").padStart(11, "0");

      const payload = {
        client_id: process.env.SOLUTI_CLIENT_ID,
        client_secret: process.env.SOLUTI_CLIENT_SECRET,
        grant_type: "password",
        username: cpfFormatado,
        password: otp,
        // Adicionado service_2fa conforme seus logs mostraram ser necessário
        scope: "signature_session",
      };

      const response = await axios.post(
        `${process.env.SOLUTI_OAUTH_URL}/oauth`,
        payload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      const accessToken = response.data?.access_token;

      if (!accessToken) {
        throw new Error("Token de acesso não retornado pela Soluti.");
      }

      let authSchema = response.data?.Authorization;

      if (!authSchema) {
        // O provedor padrão geralmente é 'SOLUTI'. Se a API mandar outro, usamos ele.
        const provider = response.data?.provider || "SOLUTI";

        // Concatena o provedor, o separador '-|' e o token
        const schemaString = `${provider}-|${accessToken}`;

        // Converte para Base64 (Exigência do BirdID Pro)
        const base64Schema = Buffer.from(schemaString).toString("base64");

        // Monta a string final
        authSchema = `VCSchema ${base64Schema}`;
      }

      return {
        access_token: accessToken,
        authorization_schema: authSchema,
      };
    } catch (error) {
      console.error(
        "[Soluti] ❌ Erro no Token:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  /**
   * 🧾 2. Preparar/Assinar documento
   * Ajustado para lidar com o retorno 'SIGNED' direto.
   */
  static async prepararDocumento(pdfBase64, authorizationToken) {
    try {
      // Remove possíveis prefixos data:application/pdf;base64,
      const pureBase64 = pdfBase64.replace(
        /^data:application\/pdf;base64,/,
        "",
      );
      const dataUrl = `data:application/pdf;base64,${pureBase64}`;

      const payload = {
        certificate_alias: "ALEXANDRE DE PAULA DIAS JUNIOR:44955657885",
        type: "PDFSignature",
        hash_algorithm: "SHA256",
        // --- INCLUIR ESTAS DUAS LINHAS ---
        tsa_server_id: "COLOQUE_AQUI_O_ID_DA_SUA_CARIMBADORA",
        tsa_hash_algorithm: "SHA256",
        // ---------------------------------
        auto_fix_document: true,
        mode: "sync", // Com sync, ele tenta assinar na hora se o token permitir
        signature_settings: [
          {
            id: "default",
            reason: "Assinatura Digital de Prescrição Médica",
            visible_signature: true, // Isso avisa o Acrobat que a assinatura DEVE ser visível
            visual_representation: {
              text: {
                value:
                  "Assinado digitalmente por {{signer_name}}\nData: {{date}}",
                include_email: false,
                include_cpf: false,
              },
              position: {
                page: -1,
                x: 50,
                y: 100,
                width: 300,
                height: 60,
                measurement_unit: "pt",
              },
            },
            extraInfo: [{ name: "2.16.1.12.1.2", value: "Prescrição Médica" }],
          },
        ],
        documents_source: "DATA_URL",
        documents: [{ id: "doc1", data: dataUrl }],
      };

      const response = await axios.post(
        `${process.env.SOLUTI_CESS_URL}/signature-service`,
        payload,
        {
          headers: {
            Authorization: authorizationToken,
            "Content-Type": "application/json",
          },
        },
      );

      const doc = response.data?.documents?.[0];
      if (!doc) throw new Error("Documento não retornado na resposta.");

      console.log(`[SERVER] Status do documento: ${doc.status}`);

      // Se já estiver assinado, retornamos o result (URL do arquivo)
      if (doc.status === "SIGNED") {
        return {
          status: "SIGNED",
          download_url: doc.result, // URL para baixar o PDF final
          checksum: doc.checksum,
        };
      }

      // Caso contrário, seguimos o fluxo de Hash (se a API retornar)
      if (doc.prepared_hash) {
        return {
          status: "PENDING",
          prepared_hash: doc.prepared_hash,
        };
      }

      throw new Error("API não retornou nem o documento assinado, nem o hash.");
    } catch (error) {
      console.error(
        "[Soluti] ❌ Erro na Preparação:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  /**
   * 📥 3. Download do PDF Assinado
   * Necessário porque a Soluti devolve uma URL de 'result'
   */
  static async baixarDocumentoAssinado(url, authorizationToken) {
    try {
      const response = await axios.get(url, {
        headers: { Authorization: authorizationToken },
        responseType: "arraybuffer", // Importante para binários/PDF
      });

      return Buffer.from(response.data).toString("base64");
    } catch (error) {
      console.error("[Soluti] ❌ Erro ao baixar PDF:", error.message);
      throw error;
    }
  }
}

module.exports = SolutiService;
