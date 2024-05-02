import mongoose from "mongoose";

const HubSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.ObjectId, ref: "Seller", required: true },

  //  "hub_details":{
  name: { type: String, required: true },
  pincode: { type: Number, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  address1: { type: String, required: true },
  address2: { type: String, required: false },
  contactPersonName: { type: String, required: true },
  phone: { type: String, required: true },
  delivery_type_id: { type: Number, required: false },

  isActive: { type: Boolean, required: false, default: true },
  hub_id: { type: Number, required: false },

});

const HubModel = mongoose.model("Hub", HubSchema);
export default HubModel;
