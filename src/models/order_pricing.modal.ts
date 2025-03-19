import mongoose from "mongoose";

const pricingSchema = {
  basePrice: { type: Number, required: true, min: 0 },
  incrementPrice: { type: Number, required: true, min: 0 },
  isRTOSameAsFW: { type: Boolean, required: true, defualt: true },
  flatRTOCharge: { type: Number, required: false, min: 0, default: 0 },
  
  rtoBasePrice: { type: Number, required: false, min: 0 },
  rtoIncrementPrice: { type: Number, required: false, min: 0 },
};
const codSchema = {
  hard: { type: Number, required: true, min: 0 },
  percent: { type: Number, required: true, min: 0 },
}
const OrderPricingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    order_reference_id: { type: String, required: true },
    codCharge: { type: codSchema, required: true },
    withinCity: { type: pricingSchema, required: true },
    withinZone: { type: pricingSchema, required: true },
    withinMetro: { type: pricingSchema, required: true },
    withinRoi: { type: pricingSchema, required: true },
    northEast: { type: pricingSchema, required: true },
    charge: { type: Number, required: false},
    orderCodCharge: { type: Number, required: false},
  },
  { timestamps: true }
);

const OrderPricingModel = mongoose.model("OrderPricing", OrderPricingSchema);
export default OrderPricingModel;