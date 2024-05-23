import mongoose from "mongoose";

const pricingSchema = {
  basePrice: { type: Number, required: true, min: 0 },
  incrementPrice: { type: Number, required: true, min: 0 },
};
const CustomPricingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", unique: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Courier" },
    withinCity: { type: pricingSchema, required: true },
    withinZone: { type: pricingSchema, required: true },
    withinMetro: { type: pricingSchema, required: true },
    withinRoi: { type: pricingSchema, required: true },
    northEast: { type: pricingSchema, required: true },
  },
  { timestamps: true }
);

const CustomPricingModel = mongoose.model("CustomPricing", CustomPricingSchema);
export default CustomPricingModel;
