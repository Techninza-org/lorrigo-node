import mongoose from "mongoose";


const ChannelSchema = new mongoose.Schema(
    {
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
        channelName: { type: String, required: true },
        isOrderSync: { type: String, required: true },
        storeUrl: { type: String, required: true },
        apiKey: { type: String, required: true, unique: true },
        apiSk: { type: String, required: true },
        sharedSecret: { type: String, required: true },

    }, { timestamps: true }
);

const ChannelModel = mongoose.model("Channel", ChannelSchema);
export default ChannelModel;
