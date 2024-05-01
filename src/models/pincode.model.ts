import mongoose from "mongoose";

const pinCodeSchema = new mongoose.Schema({
  "Circle Name": { type: String, required: true },
  "Region Name": { type: String, required: true },
  "Division Name": { type: String, required: true },
  "Office Name": { type: String, required: true },
  Pincode: { type: Number, required: true },
  "Office Type": { type: String, required: true },
  Delivery: { type: String, required: true },
  District: { type: String, required: true },
  StateName: { type: String, required: true },
});

const PincodeModel = mongoose.model("Pincodes", pinCodeSchema);

export default PincodeModel;
