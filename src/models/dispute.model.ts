import mongoose from "mongoose";

const disputeModel = new mongoose.Schema({
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "ClientBilling" },
    awb: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String, required: false },
    accepted: { type: Boolean, default: false }
});

const SellerDisputeModel = mongoose.model("Dispute", disputeModel);
export default SellerDisputeModel;
