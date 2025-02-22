import mongoose from "mongoose";

const pricingSchema = {
  basePrice: { type: Number, required: true, min: 0 },
  incrementPrice: { type: Number, required: true, min: 0 },
  isRTOSameAsFW: { type: Boolean, required: true, defualt: true },
  flatRTOCharge: { type: Number, required: true, min: 0 },
};
const codSchema = {
  hard: { type: Number, required: true, min: 0 },
  percent: { type: Number, required: true, min: 0 },
}
const CustomPricingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Courier" },
    codCharge: { type: codSchema, required: true },
    withinCity: { type: pricingSchema, required: true },
    withinZone: { type: pricingSchema, required: true },
    withinMetro: { type: pricingSchema, required: true },
    withinRoi: { type: pricingSchema, required: true },
    northEast: { type: pricingSchema, required: true },
  },
  { timestamps: true }
);

const CustomB2BPricingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    B2BVendorId: { type: mongoose.Schema.Types.ObjectId, ref: "B2BCalc" },
    foValue: { type: Number, required: true, default: 100 },
    foPercentage: { type: String, required: true, default: 0.001 },

    baseFreight: { type: Number, required: true, min: 0 },
    greenTax: { type: Number, required: true, min: 100 }, // 100rs
    fuelSurcharge: { type: Number, required: true, min: 0 }, // in percentage
    ODACharge: { type: Number, required: true, min: 0 }, // 5rs per kg, 800rs min
    docketCharge: { type: Number, required: true, min: 0 }, //100rs
    zoneMatrix: { type: Map, of: Map }, // Stores the rate matrix
  },
  { timestamps: true }
);

const CustomB2BPricingModel = mongoose.model("CustomB2BPricing", CustomB2BPricingSchema);
const CustomPricingModel = mongoose.model("CustomPricing", CustomPricingSchema);

export default CustomPricingModel;
export { CustomB2BPricingModel }; 
