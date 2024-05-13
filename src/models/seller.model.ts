import mongoose from "mongoose";

const sellerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  walletBalance: { type: Number, default: 0, min: 0 },
  entityType: { type: String, required: false },
  // below feild need to remove
  gst: { type: String, required: false },
  pan: { type: String, required: false },
  aadhar: { type: String, required: false },

  prefix: { type: String, required: false },
  address: { type: String, required: false },
  margin: { type: Number, min: 0, max: 100, default: 20 },
  vendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Courier" }],
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  gstInvoice: {
    gstin: { type: String, required: false },
    tan: { type: String, required: false },
    deductTDS: { type: String, required: false },
  },
  companyProfile: {
    companyId: { type: String, required: false },
    companyName: { type: String, required: false },
    website: { type: String, required: false },
    companyEmail: { type: String, required: false },
    companyLogo: { type: String, required: false },
  },
  billingAddress: {
    address_line_1: { type: String, required: false },
    address_line_2: { type: String, required: false },
    city: { type: String, required: false },
    state: { type: String, required: false },
    pincode: { type: String, required: false },
    phone: { type: String, required: false },
  },
  kycDetails: {
    businessType: { type: String, required: false },
    photoUrl: { type: String, required: false },
    pan: { type: String, required: false },
    adhaar: { type: String, required: false },

    document1Type: { type: String, required: false },
    document1Feild: { type: String, required: false },
    document1Front: { type: String, required: false },
    document1Back: { type: String, required: false },

    document2Type: { type: String, required: false },
    document2Feild: { type: String, required: false },
    document2Front: { type: String, required: false },
    document2Back: { type: String, required: false },
    submitted: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
  },
  bankDetails: {
    accHolderName: { type: String, required: false },
    accNumber: { type: String, required: false },
    ifscNumber: { type: String, required: false },
    accType: { type: String, required: false },
  },
  channelPartners: [{ type: mongoose.Schema.Types.ObjectId, ref: "Channel" }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

const SellerModel = mongoose.model("Seller", sellerSchema);

export default SellerModel;
