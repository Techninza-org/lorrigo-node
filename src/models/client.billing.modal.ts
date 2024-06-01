import mongoose from "mongoose";

const modal = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
  orderRefId: { type: String, required: true },
  awb: { type: String, required: true },
  rtoAwb: { type: String, required: true },
  recipientName: { type: String, required: true },
  shipmentType: { type: Number, required: true },  // COD --> 1, Prepaid-->0
  fromCity: { type: String, required: true },
  toCity: { type: String, required: true },
  chargedWeight: { type: Number, required: true },
  zone: { type: String, required: true },
  isForwardApplicable: { type: Boolean, required: true },
  isRTOApplicable: { type: Boolean, required: true },
  billingDate: { type: Date, required: true },
  billingAmount: { type: String, required: true },
});

const ClientBillingModal = mongoose.model("ClientBilling", modal);
export default ClientBillingModal;