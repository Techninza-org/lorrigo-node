import mongoose from "mongoose";

const disputeModel = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
  clientBillingId: { type: mongoose.Schema.Types.ObjectId, ref: "ClientBilling" },
  awb: { type: String, required: true },
  product: { type: String, required: false },
  description: { type: String, required: false },
  image: { type: String, required: false },
  accepted: { type: Boolean, default: false },
  stage: {type: Number, default: 0}, // 0: Not Raised, 1: Raised, 2: Accepted, 3: Rejected
  orderBoxHeight: { type: Number, required: false },
  orderBoxWidth: { type: Number, required: false },
  orderBoxLength: { type: Number, required: false },
  orderSizeUnit: { type: String, required: false },
  orderWeight: { type: Number, required: false },
  chargedWeight: { type: Number, required: false },
  orderWeightUnit: { type: String, required: false },
  billingMonth: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
});

const SellerDisputeModel = mongoose.model("Dispute", disputeModel);
export default SellerDisputeModel;
