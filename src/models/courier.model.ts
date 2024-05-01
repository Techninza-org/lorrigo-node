import mongoose, { Types } from "mongoose";

const currentTime = new Date().getHours() + ":" + new Date().getMinutes() + ":" + new Date().getSeconds();

const pricingSchema = {
  basePrice: { type: Number, required: true, min: 0 },
  incrementPrice: { type: Number, required: true, min: 0 },
};

const codSchema = {
  hard: { type: Number, required: true, min: 0, default: 40 },
  percent: { type: Number, required: true, min: 0, max: 100, default: 1.5 },
};

export const courierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    vendor_channel_id: { type: Types.ObjectId, ref: "Env" ,required: true },
    weightSlab: { type: Number, required: true },
    weightUnit: { type: String, required: true },
    codCharge: { type: codSchema, required: true, default: { hard: 40, percent: 1.5 } },
    incrementWeight: { type: Number, required: true },
    type: { type: String, required: true }, // surface , air
    pickupTime: { type: String, required: true, default: currentTime },
    withinCity: { type: pricingSchema, required: true },
    withinZone: { type: pricingSchema, required: true },
    withinMetro: { type: pricingSchema, required: true },
    withinRoi: { type: pricingSchema, required: true },
    northEast: { type: pricingSchema, required: true },
    carrierID: { type: Number, required: true },
  },
  { timestamps: true }
);

const CourierModel = mongoose.model("Courier", courierSchema);
export default CourierModel;
