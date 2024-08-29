import mongoose from "mongoose";

const modal = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  orderRefId: { type: String, required: true },
  awb: { type: String, required: true },
  orderWeight: { type: Number, required: true },
  billingDate: { type: Date, required: true },
  billingAmount: { type: Number, required: true },
  otherCharges: { type: String, required: false },
  isODAApplicable: { type: Boolean, required: true },
  vendorWNickName: { type: String, required: true },
});

const B2BClientBillingModal = mongoose.model("B2BClientBilling", modal);
export default B2BClientBillingModal;
