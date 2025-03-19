import mongoose from "mongoose";

const RemittanceSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.ObjectId, ref: "Seller", required: true },

  remittanceId: { type: String, required: true, unique: true},
  remittanceDate: { type: String, required: true },
  remittanceAmount: { type: Number, required: true },
  remittanceStatus: { type: String, required: true },
  orders : { type: Array, required: true },
  BankTransactionId : { type: String, required: true },

});
RemittanceSchema.index({ sellerId: 1, remittanceDate: -1 });
RemittanceSchema.index({ remittanceStatus: 1 });
RemittanceSchema.index({ remittanceId: "text", BankTransactionId: "text" });

const RemittanceModel = mongoose.model("Remittance", RemittanceSchema);
export default RemittanceModel;
