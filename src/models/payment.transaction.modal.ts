import mongoose from "mongoose";


const PaymentTransaction = new mongoose.Schema(
    {
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "seller", required: true },
        merchantTransactionId: { type: String, required: true },
        amount: { type: String, required: true },
        code: { type: String, required: true },
        desc: { type: String, required: true },
        data: { type: Object },
        stage: [
            {
                action: { type: String, required: true },
                dateTime: { type: Date, required: true },
            },
        ],

    }, { timestamps: true }
);

const PaymentTransactionModal = mongoose.model("Transaction", PaymentTransaction);
export default PaymentTransactionModal;
