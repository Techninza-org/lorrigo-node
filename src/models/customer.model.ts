import mongoose from "mongoose";

const consigneeModel = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  address: { type: String, required: true },
  state: { type: String, required: false },
  city: { type: String, required: false },
  pincode: { type: String, required: true },
});

const B2BCustomerModel = mongoose.model("B2BCustomer", consigneeModel);
export default B2BCustomerModel;
