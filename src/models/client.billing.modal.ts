import mongoose from "mongoose";

const modal = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  orderRefId: { type: String, required: true },
  awb: { type: String, required: true },
  rtoAwb: { type: String, required: false },
  recipientName: { type: String, required: true },
  shipmentType: { type: Number, required: true },  // COD --> 1, Prepaid-->0
  fromCity: { type: String, required: true },
  toCity: { type: String, required: true },
  chargedWeight: { type: Number, required: true },
  zone: { type: String, required: true },
  isForwardApplicable: { type: Boolean, required: true },
  isRTOApplicable: { type: Boolean, required: true },
  billingDate: { type: Date, required: true },
  billingAmount: { type: String, required: false },
  incrementPrice : { type: String, required: false },
  basePrice : { type: String, required: false },
  baseWeight : { type: String, required: false },
  incrementWeight : { type: String, required: false },
  vendorWNickName: { type: String, required: false },
});

const ClientBillingModal = mongoose.model("ClientBilling", modal);
export default ClientBillingModal;
