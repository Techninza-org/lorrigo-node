import mongoose, { Mongoose } from "mongoose";
import { paymentStatusInfo } from "../utils/recharge-wallet-info";

const modal = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  orderRefId: { type: String, required: true },
  awb: { type: String, required: true },
  rtoAwb: { type: String, required: false },
  recipientName: { type: String, required: true },
  shipmentType: { type: Number, required: true },  // COD --> 1, Prepaid-->0
  orderCharges: { type: String, required: false },
  fromCity: { type: String, required: true },
  toCity: { type: String, required: true },
  rtoCharge: { type: String, required: true, default: 0 }, 
  codValue: { type: String, required: true },
  carrierID: { type: mongoose.Types.ObjectId, ref: "Courier", required: true },
  orderWeight: { type: String, required: true },
  chargedWeight: { type: Number, required: true },
  fwExcessCharge: { type: String, required: true },
  zone: { type: String, required: true },
  isForwardApplicable: { type: Boolean, required: true },
  isRTOApplicable: { type: Boolean, required: true },
  billingDate: { type: Date, default: Date.now },
  billingAmount: { type: String, required: false },
  incrementPrice: { type: String, required: false },
  basePrice: { type: String, required: false },
  baseWeight: { type: String, required: false },
  incrementWeight: { type: String, required: false },
  vendorWNickName: { type: String, required: false },
  isDisputeRaised: { type: Boolean, default: false },
  disputeAcceptedBySeller: { type: Boolean, default: false },
  disputeId: { type: mongoose.Types.ObjectId, ref: "Dispute" },
  paymentStatus: { type: String, default: paymentStatusInfo.NOT_PAID }
});

const ClientBillingModal = mongoose.model("ClientBilling", modal);
export default ClientBillingModal;
