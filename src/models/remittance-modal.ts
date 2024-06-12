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

const RemittanceModel = mongoose.model("Remittance", RemittanceSchema);
export default RemittanceModel;
