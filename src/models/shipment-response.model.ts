import mongoose from "mongoose";

const shipmentresponseSchema = new mongoose.Schema(
  {
    // status: { type: Number, required: false },
    // code: { type: Number, required: false },
    // message: { type: String, required: false },
    // data: {
    //   summary: {
    //     start_time: { type: String, required: false },
    //     end_time: { type: String, required: false },
    //     time_taken: { type: String, required: false },
    //   },
    //   type: mongoose.Schema.Types.Mixed,
    //   required: false,
    // },
    // total_records: { type: Number, required: false },
    // total_success_orders: { type: Number, required: false },
    // request_id: { type: Number, required: false },
    // total_eliminated_order: { type: Number, required: false },
    // // success_order_details: [
    // //   {
    // //     index: 0,
    // //     client_order_reference_id: { type: String, required: false },
    // //     request_order_id: { type: Number, required: false },
    // //     cost_estimation: {
    // //       forward: {
    // //         freight_charges: { type: Number, required: false },
    // //         region: { type: String, required: false },
    // //         fuel_surcharge: { type: Number, required: false },
    // //         fuel_surcharge_percentage: { type: Number, required: false },
    // //         insurance_type: { type: String, required: false },
    // //         insurance_charges_percentage: { type: String, required: false },
    // //         maximum_insured_value: { type: String, required: false },
    // //         insurance_charges: { type: Number, required: false },
    // //         cod_charges: { type: String, required: false },
    // //         shipping_cost: { type: Number, required: false },
    // //         shipping_cost_tax_amount: { type: Number, required: false },
    // //         total_shipping_cost: { type: Number, required: false },
    // //         type: mongoose.Schema.Types.Map,
    // //         required: false,
    // //       },
    // //       rto: {
    // //         fuel_surcharge: { type: Number, required: false },
    // //         fuel_surcharge_percentage: { type: String, required: false },
    // //         freight_charges: { type: Number, required: false },
    // //         region: { type: String, required: false },
    // //         shipping_cost_tax_amount: { type: Number, required: false },
    // //         total_shipping_cost: { type: Number, required: false },
    // //         type: mongoose.Schema.Types.Map,
    // //         required: false,
    // //       },
    // //       type: mongoose.Schema.Types.Map,
    // //       required: false,
    // //     },
    // //     sc_confirmation_no: { type: Number, required: false },
    // //     message: { type: String, required: false },
    // //     type: mongoose.Schema.Types.Map,
    // //     required: false,
    // //   },
    // // ],
  },
  { strict: false }
);
const ShipmentResponseModel = mongoose.model("ShipmentResponse", shipmentresponseSchema);
export default ShipmentResponseModel;
