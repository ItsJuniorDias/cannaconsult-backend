const mongoose = require("mongoose");

// Definição do Schema do Documento
const DocumentoSchema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true },
  secretCode: { type: String, required: true },
  tipo: { type: String, required: true },
  pdfBase64: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Criando o Model
const Documento = mongoose.model("Documento", DocumentoSchema);

module.exports = Documento;
