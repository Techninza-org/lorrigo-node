import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  hsn_code: { type: String, required: false },
  quantity: { type: String, required: true },
  invoice_value: { type: String, required: false },
  tax_rate: { type: String, required: true },
  taxable_value: { type: String, required: true },
  sgst_amount: { type: String, required: false },
  sgst_tax_rate: { type: String, required: false },
  cgst_amount: { type: String, required: false },
  cgst_tax_rate: { type: String, required: false },
});

const ProductModel = mongoose.model("Products", ProductSchema);
export default ProductModel;