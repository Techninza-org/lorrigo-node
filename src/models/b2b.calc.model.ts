import mongoose, { Types } from "mongoose";

const currentTime = new Date().getHours() + ":" + new Date().getMinutes() + ":" + new Date().getSeconds();


const B2BCalcSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        type: { type: String, required: true }, // surface , air
        pickupTime: { type: String, required: true, default: currentTime },
        vendor_channel_id: { type: Types.ObjectId, ref: "Env", required: true },
        foValue: { type: Number, required: true, default: 100 },
        foPercentage: { type: String, required: true, default: 0.001 },

        carrierID: { type: Number, required: true },
        isActive: { type: Boolean, required: true, default: true },
        isReversedCourier: { type: Boolean, required: true, default: false },

        baseFreight: { type: Number, required: true, min: 0 },
        greenTax: { type: Number, required: true, min: 100 }, // 100rs
        fuelSurcharge: { type: Number, required: true, min: 0 }, // in percentage
        ODACharge: { type: Number, required: true, min: 0 }, // 5rs per kg, 800rs min
        docketCharge: { type: Number, required: true, min: 0 }, //100rs
        zoneMatrix: { type: Map, of: Map }, // Stores the rate matrix
        zoneMapping: { type: Map, of: [String] }, // Maps zone names to regions

        transporter_id: { type: String, required: false },
        transporter_name: { type: String, required: false },
    },
    { timestamps: true }
);

const B2BCalcModel = mongoose.model("B2BCalc", B2BCalcSchema);
export default B2BCalcModel;
