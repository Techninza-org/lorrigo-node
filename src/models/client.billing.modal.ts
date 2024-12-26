import mongoose, { Mongoose } from "mongoose";
import { paymentStatusInfo } from "../utils/recharge-wallet-info";

const modal = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  carrierID: { type: mongoose.Types.ObjectId, ref: "Courier", required: true },
  disputeId: { type: mongoose.Types.ObjectId, ref: "Dispute" },
  disputeAcceptedBySeller: { type: Boolean, default: false },

  orderRefId: { type: String, required: true },
  awb: { type: String, required: true },
  rtoAwb: { type: String, required: false },

  recipientName: { type: String, required: true },
  fromCity: { type: String, required: true },
  toCity: { type: String, required: true },

  shipmentType: { type: Number, required: true },  // COD --> 1, Prepaid-->0
  orderCharges: { type: String, required: false },
  
  orderWeight: { type: String, required: true },
  chargedWeight: { type: Number, required: true },
  fwCharge: { type: String, required: true, default: 0 }, 
  rtoCharge: { type: String, required: true, default: 0 }, 
  codValue: { type: String, required: true },
  fwExcessCharge: { type: String, required: true },
  rtoExcessCharge: { type: String, required: true },
  zone: { type: String, required: true },

  isForwardApplicable: { type: Boolean, required: true },
  isRTOApplicable: { type: Boolean, required: true },

  billingAmount: { type: String, required: false },
  incrementPrice: { type: String, required: false },
  basePrice: { type: String, required: false },
  baseWeight: { type: String, required: false },
  vendorWNickName: { type: String, required: false },
  isDisputeRaised: { type: Boolean, default: false },
  paymentStatus: { type: String, default: paymentStatusInfo.NOT_PAID },

  billingDate: { type: Date, default: Date.now },
});

const ClientBillingModal = mongoose.model("ClientBilling", modal);
export default ClientBillingModal;
