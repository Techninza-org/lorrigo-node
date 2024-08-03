import envConfig from "../config";

/* Smartship */
export const HUB_REGISTRATION = "/v2/app/Fulfillmentservice/hubRegistration";
export const HUB_UPDATE = "/v2/app/Fulfillmentservice/updateHubDetails";
export const HUB_DELETE = "/v2/app/Fulfillmentservice/deleteHub";
export const HUB_SERVICEABILITY = "/v2/app/Fulfillmentservice/ServiceabilityHubWise";
export const RATE_CALCULATION = "/v2/app/Fulfillmentservice/rateCalculator";
export const CREATE_SHIPMENT = "/v2/app/Fulfillmentservice/orderRegistrationOneStep";
export const CANCEL_SHIPMENT = "/v2/app/Fulfillmentservice/orderCancellation";
export const ORDER_REATTEMPT = "/v2/app/Fulfillmentservice/orderReattempt";
export const TRACK_SHIPMENT = "/v1/Trackorder?order_reference_ids"; // url => TRACK_SHIPMENT+"=order_reference_id"
export const ORDER_MANIFEST = "/v2/app/Fulfillmentservice/createManifest";

const PIN_CODE = "https://uat.smartr.in/api/v1/pincode/";

/* Shiprocket API */

const CREATE_PICKUP_LOCATION = "/v1/external/settings/company/addpickup";
const SHIPROCKET_UPDATE_ORDER = "/v1/external/orders/update/adhoc";
const SHIPROCKET_UPDATE_CUSTOMER = "/v1/external/orders/address/updatE";
const CREATE_SHIPROCKET_ORDER = "/v1/external/orders/create/adhoc";
const CREATE_SHIPROCKET_RETURN_ORDER = "/v1/external/orders/create/return";
const GENRATE_AWB_SHIPROCKET = "/v1/external/courier/assign/awb";
const LIST_SHIPROCKET_COURIER = "/v1/external/courier/courierListWithCounts";
const SHIPROCKET_ORDER_COURIER = "/v1/external/courier/serviceability";
const CANCEL_SHIPMENT_SHIPROCKET = "/v1/external/orders/cancel/shipment/awbs";
const GET_MANIFEST_SHIPROCKET = "/v1/external/courier/generate/pickup"
const SHIPROCKET_ORDER_TRACKING = "/v1/external/courier/track/awb";
const SHIPROCKET_ORDER_NDR = "/v1/external/ndr";

/* Shopify */

const SHOPIFY_CUSTOMER = '/admin/api/2024-04/customers.json';
const SHOPIFY_ORDER = '/admin/api/2024-04/orders.json';
const SHOPIFY_FULFILLMENT_ORDER = '/admin/api/2023-01/orders';
const SHOPIFY_FULFILLMENT = '/admin/api/2024-04/fulfillments.json';
const SHOPIFY_FULFILLMENT_CANCEL = '/admin/api/2024-04/orders';

const SMARTR_CREATE_SHIPMENT = "/api/v1/add-order";
const SMARTR_PINCODE_SERVICEABILITY = "/api/v1/pincode/";
const CANCEL_ORDER_SMARTR = "/api/v1/updateCancel/";
const SMARTR_TRACKING = "/api/v1/tracking/?awb=";

const PHONEPE_PAY_API = "/pg/v1/pay";
const PHONEPE_CONFIRM_API = "/pg/v1/status";

const DELHIVERY_PINCODE_SERVICEABILITY = "/c/api/pin-codes/json/?filter_codes="
const DELHIVERY_PICKUP_LOCATION = "/api/backend/clientwarehouse/create/"
const DELHIVERY_CREATE_ORDER = "/api/cmu/create.json"
const DELHIVERY_CANCEL_ORDER = "/api/p/edit"
const DELHIVERY_TRACK_ORDER = "/api/v1/packages/json/?waybill="
const DELHIVERY_MANIFEST_ORDER = "/fm/request/new"

const ECOMM_PINCODE_SERVICEABILITY = "/services/expp/expppincode/";

const ZOHO_CREATE_USER = `/books/v3/users?organization_id=${envConfig.ZOHO_ORG_ID}`

const MARUTI_SERVICEABILITY = "/fulfillment/public/seller/order/check-ecomm-order-serviceability";

const APIs = {
  HUB_REGISTRATION,
  HUB_UPDATE,
  HUB_DELETE,
  RATE_CALCULATION,
  CREATE_SHIPMENT,
  HUB_SERVICEABILITY,
  CANCEL_SHIPMENT,
  ORDER_REATTEMPT,
  TRACK_SHIPMENT,
  ORDER_MANIFEST,

  PIN_CODE,

  CREATE_PICKUP_LOCATION,
  CREATE_SHIPROCKET_ORDER,
  SHIPROCKET_UPDATE_ORDER,
  SHIPROCKET_UPDATE_CUSTOMER,
  LIST_SHIPROCKET_COURIER,
  GENRATE_AWB_SHIPROCKET,
  SHIPROCKET_ORDER_COURIER,
  CANCEL_SHIPMENT_SHIPROCKET,
  GET_MANIFEST_SHIPROCKET,
  SHIPROCKET_ORDER_TRACKING,
  SHIPROCKET_ORDER_NDR,
  CREATE_SHIPROCKET_RETURN_ORDER,

  SHOPIFY_ORDER,
  SHOPIFY_CUSTOMER,
  SHOPIFY_FULFILLMENT_ORDER,
  SHOPIFY_FULFILLMENT,
  SHOPIFY_FULFILLMENT_CANCEL,

  SMARTR_CREATE_SHIPMENT,
  SMARTR_PINCODE_SERVICEABILITY,
  CANCEL_ORDER_SMARTR,
  SMARTR_TRACKING,

  PHONEPE_PAY_API,
  PHONEPE_CONFIRM_API,


  DELHIVERY_PINCODE_SERVICEABILITY,
  DELHIVERY_PICKUP_LOCATION,
  DELHIVERY_CREATE_ORDER,
  DELHIVERY_CANCEL_ORDER,
  DELHIVERY_MANIFEST_ORDER,
  DELHIVERY_TRACK_ORDER,

  ECOMM_PINCODE_SERVICEABILITY,

  ZOHO_CREATE_USER,

  MARUTI_SERVICEABILITY

};
export default APIs;
