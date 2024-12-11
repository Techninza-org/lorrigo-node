import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // Key for the counter (e.g., 'phonepe')
    value: { type: Number, required: true, default: 10635 },
});

const Counter = mongoose.model('Counter', counterSchema);

export default Counter;