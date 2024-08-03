import mongoose from "mongoose";

const envSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    nickName: {
        type: String,
        unique: true,
        required: true
    },
    token: {
        type: String,
        required: true
    },
    refreshToken: { 
        type: String,
        required: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // Adding timestamps as before
});

const EnvModel = mongoose.model("Env", envSchema);
export default EnvModel;