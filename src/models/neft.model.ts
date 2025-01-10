import mongoose from "mongoose";

const NeftSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    invoiceNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    paymentReferenceNumber: { type: String, required: true },
    amount: { type: String, required: true },
    transactionDate: { type: String, required: true },
  },
  { timestamps: true }
);

const NeftModel = mongoose.model("Neft", NeftSchema);
export default NeftModel;
