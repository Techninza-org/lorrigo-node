import mongoose, { Types } from "mongoose";
import { codSchema, pricingSchema } from "./courier.model";

const currentTime = new Date().getHours() + ":" + new Date().getMinutes() + ":" + new Date().getSeconds();

export const shipmenAwbCourierSchema = new mongoose.Schema(
  {
    awb: { type: String, required: true, unique: true },
    name: { type: String, required: true },

    weightSlab: { type: Number, required: true },
    weightUnit: { type: String, required: true },

    isRtoDeduct: { type: Boolean, required: false, defualt: true },
    isFwdDeduct: { type: Boolean, required: false, defualt: true },
    isCodDeduct: { type: Boolean, required: false, defualt: true },

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
    isActive: { type: Boolean, required: true, default: true },
    isReversedCourier: { type: Boolean, required: true, default: false },
    vendor_channel_id: { type: Types.ObjectId, ref: "Env", required: true },
    cod: { type: Number, required: false },
    shipmentCharge: { type: Number, required: false },
    isReverse: { type: Boolean, required: false },
  },
  { timestamps: true }
);

const ShipmenAwbCourierModel = mongoose.model("ShipmentAwbCourier", shipmenAwbCourierSchema);
export default ShipmenAwbCourierModel;
