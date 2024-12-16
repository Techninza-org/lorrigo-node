import mongoose, { Mongoose } from "mongoose";

const NotInInvoiceAwbSchema = new mongoose.Schema({
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    notBilledAwb: { type: Array, required: true },
    monthOf: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const NotInInvoiceAwbModel = mongoose.model("NotInInvoiceAwb", NotInInvoiceAwbSchema);
export default NotInInvoiceAwbModel;