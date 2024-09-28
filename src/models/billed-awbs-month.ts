import mongoose, { Schema } from "mongoose";

interface MonthlyBilledAWB extends Document {
  sellerId: string;
  awb: string;
  billingDate: Date;
}

const MonthlyBilledAWBSchema: Schema = new Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  awb: { type: String, required: true },

  billingDate: { type: Date, required: true },
  billingAmount: { type: String, required: false },
  zone: { type: String, required: true },
  incrementPrice: { type: String, required: false },
  chargedWeight: { type: String, required: true },

  basePrice: { type: String, required: false },
  baseWeight: { type: String, required: false },

  isForwardApplicable: { type: Boolean, required: true },
  isRTOApplicable: { type: Boolean, required: true },
});

MonthlyBilledAWBSchema.index({ sellerId: 1, awb: 1, billingDate: 1 }, { unique: true });

export const MonthlyBilledAWBModel = mongoose.model<MonthlyBilledAWB>('MonthlyBilledAWB', MonthlyBilledAWBSchema);

