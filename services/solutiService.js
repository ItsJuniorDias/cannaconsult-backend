const axios = require("axios");

class SolutiService {
  /**
   * 🚀 1. Inicia o processo de assinatura PAdES
   * Substitui todo o fluxo de OAuth Token e Hash CMS.
   */
  static async iniciarAssinaturaPAdES(
    cpf,
    otp,
    pdfBase64,
    docId = "receituario_canna_01",
  ) {
    try {
      console.log(`[DEBUG] Tentando assinar CPF: ${cpf} com OTP: ${otp}`);

      if (!pdfBase64) throw new Error("Base64 do PDF ausente");

      // A API CESS exige a autenticação Basic no formato base64(cpf:otp)
      const authCredentials = Buffer.from(`${cpf}:${otp}`).toString("base64");

      // Opcional: Se tiver um webhook configurado no seu .env para receber o callback
      const webhookUrl = process.env.SOLUTI_WEBHOOK_URL || "";

      const payload = {
        // certificate_alias pode ser vazio ou o próprio CPF dependendo da config do seu cofre
        certificate_alias: cpf,
        type: "PAdES",
        mode: "async",
        notification_callback: webhookUrl,
        documents_source: "DATA_URL",
        documents: [
          {
            id: docId,
            original_file_name: `${docId}.pdf`,
            content: `data:application/pdf;base64,${pdfBase64}`,
          },
        ],
      };

      const response = await axios.post(
        `${process.env.SOLUTI_CESS_URL}/signature-service`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${authCredentials}`,
          },
          timeout: 20000,
        },
      );

      if (!response.data?.tcn) {
        throw new Error("TCN (Token de Transação) não retornado pela Soluti");
      }

      // Retorna o TCN para você salvar no banco atrelado a essa consulta/prescrição
      return response.data.tcn;
    } catch (error) {
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error(
        "[Soluti CESS] ❌ Erro ao iniciar assinatura:",
        detalheErro,
      );
      throw new Error(`Falha na API BirdID PRO: ${detalheErro}`);
    }
  }

  /**
   * 🔄 2. Verifica o status da transação (Polling ou via Webhook)
   */
  static async verificarStatus(tcn, docId = "receituario_canna_01") {
    try {
      const response = await axios.get(
        `${process.env.SOLUTI_CESS_URL}/signature-service/${tcn}`,
        {
          headers: { Accept: "application/json" },
          timeout: 10000,
        },
      );

      const statusGeral = response.data.status; // Pode ser WAITING, PROCESSING, DONE, ERROR
      const documento = response.data.documents?.find(
        (doc) => doc.id === docId,
      );

      return {
        transacaoConcluida: statusGeral === "DONE",
        documentoStatus: documento ? documento.status : "NOT_FOUND",
        erro: documento?.error_message || null,
      };
    } catch (error) {
      const detalheErro = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      console.error("[Soluti CESS] ❌ Erro ao verificar status:", detalheErro);
      throw new Error(`Falha ao checar status do TCN ${tcn}: ${detalheErro}`);
    }
  }

  /**
   * 📥 3. Baixa o PDF já assinado (PAdES)
   */
  static async baixarDocumentoAssinado(tcn, docId = "receituario_canna_01") {
    try {
      const response = await axios.get(
        `${process.env.SOLUTI_CESS_URL}/file-transfer/${tcn}/${docId}`,
        {
          headers: { Accept: "application/pdf" },
          responseType: "arraybuffer", // 🔴 CRÍTICO para não corromper o PDF
          timeout: 20000,
        },
      );

      // Retorna o Buffer do PDF assinado para você salvar no S3 / GCP ou enviar pro paciente
      return Buffer.from(response.data);
    } catch (error) {
      const detalheErro = error.response?.data
        ? Buffer.from(error.response.data).toString("utf8") // Converte o buffer de erro para texto
        : error.message;

      console.error("[Soluti CESS] ❌ Erro ao baixar documento:", detalheErro);
      throw new Error(
        `Falha no download do documento assinado: ${detalheErro}`,
      );
    }
  }
}

module.exports = SolutiService;
