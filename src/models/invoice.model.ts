import mongoose from "mongoose";

const InvoiceSchema = new mongoose.Schema({
    invoice_id: { type: String, required: true },
    amount: { type: String, required: false },
    pdf: { type: String, required: false },
    date: { type: String, required: true },
    status: { type: String, required: false, default: "pending" },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    invoicedAwbs: { type: Array, required: false },
    isPrepaidInvoice: { type: Boolean, required: true },
}, { timestamps: true });

const InvoiceModel = mongoose.model("Invoice", InvoiceSchema);
export default InvoiceModel;