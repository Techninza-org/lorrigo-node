import mongoose from "mongoose";

const B2COrderSchema = new mongoose.Schema({
  awb: { type: String },
  shiprocket_order_id: { type: String , required: false },
  shiprocket_shipment_id: { type: String, required: false  },

  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
  bucket: { type: Number, required: true }, // 0 -> not shipped, 1 -> shipped, 2 -> Cancelation Request, 3->Canceled
  orderStages: [
    {
      stage: { type: Number, required: true },
      action: { type: String, required: true },
      stageDateTime: { type: Date, required: true },
    },
  ],
  carrierName: { type: String, required: false },
  pickupAddress: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Products", required: true },
  client_order_reference_id: { type: String, required: false },

  order_reference_id: { type: String, required: true },
  payment_mode: { type: Number, required: true }, // 0 -> prepaid, 1 -> COD
  order_invoice_date: { type: String },
  order_invoice_number: { type: String },
  isContainFragileItem: { type: Boolean, required: true, default: false },
  numberOfBoxes: { type: Number, required: true, default: 1 },
  orderBoxHeight: { type: Number, required: true },
  orderBoxWidth: { type: Number, required: true },
  orderBoxLength: { type: Number, required: true },
  orderSizeUnit: { type: String, required: true },

  orderWeight: { type: Number, required: true },
  orderWeightUnit: { type: String, required: true },

  // productCount: { type: Number, required: true, min: 1, default: 0 },
  amount2Collect: { type: Number, required: false, min: 0, default: 0 },
  ewaybill: { type: Number, required: false },

  customerDetails: {
    type: mongoose.Schema.Types.Map,
    required: true,
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  sellerDetails: {
    type: mongoose.Schema.Types.Map,
    sellerName: { type: String, required: true },
    sellerGSTIN: { type: String, required: false },
    isSellerAddressAdded: { type: Boolean, required: false },
    sellerAddress: { type: String, required: false },
    sellerCity: { type: String, required: false },
    sellerState: { type: String, required: false },
    sellerPincode: { type: Number, required: false },
    sellerPhone: { type: String, required: false },
  },

  /*
    product -> shipmentValue, taxrates
  */
});

export const packageDetailsSchema = new mongoose.Schema({
  boxLength: { type: Number, required: true },
  boxHeight: { type: Number, required: true },
  boxWidth: { type: Number, required: true },
  boxSizeUnit: { type: String, required: true }, // should be either cm or m
  boxWeight: { type: Number, required: true },
  boxWeightUnit: { type: String, required: true }, // should be either g or kg
  invoiceNumber: { type: String, required: false },
  description: { type: String, required: false },
  quantity: { type: Number, required: true, default: 1 },
});
export const ewaysSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  ewayBill: { type: String, required: true },
  invoiceNumber: { type: Number, required: true },
});
const B2BOrderSchema = new mongoose.Schema({
  client_name: { type: String, required: true },
  sellerId: { type: String, required: true },
  freightType: { type: Number, required: true, default: 0 }, // 0 -> paid, 1 -> toPay
  pickupType: { type: Number, required: true, default: 0 }, // 0 -> FM-Pickup, 1 -> SelfDrop
  InsuranceType: { type: Number, required: true, default: 0 }, // 0-> OwnerRisk, 1-> Carrier Risk
  pickupAddress: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
  invoiceNumber: { type: String, required: false },
  description: { type: String, required: false },
  totalOrderValue: { type: Number, required: true },
  amount2Collect: { type: Number, required: false, default: 0 },
  gstDetails: {
    shipperGSTIN: { type: String, required: true },
    consigneeGSTIN: { type: String, required: true },
  },
  packageDetails: {
    type: [packageDetailsSchema],
    required: true,
  },
  eways: {
    type: [ewaysSchema],
    required: true,
  },
  customers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "B2BCustomer",
    },
  ],
});
export const B2COrderModel = mongoose.model("B2COrders", B2COrderSchema);
export const B2BOrderModel = mongoose.model("B2BOrder", B2BOrderSchema);
