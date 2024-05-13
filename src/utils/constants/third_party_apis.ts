
/* Smartship */

export const HUB_REGISTRATION = "/v2/app/Fulfillmentservice/hubRegistration";
export const HUB_UPDATE = "/v2/app/Fulfillmentservice/updateHubDetails";
export const HUB_DELETE = "/v2/app/Fulfillmentservice/deleteHub";

export const HUB_SERVICEABILITY = "/v2/app/Fulfillmentservice/ServiceabilityHubWise";

export const CREATE_SHIPMENT = "/v2/app/Fulfillmentservice/orderRegistrationOneStep";
export const CANCEL_SHIPMENT = "/v2/app/Fulfillmentservice/orderCancellation";
/**
 * append order_reference_id
 * eg: TRACK_SHIPMENT + order_reference_id
 */
export const ORDER_REATTEMPT = "/v2/app/Fulfillmentservice/orderReattempt";
export const TRACK_SHIPMENT = "/v1/Trackorder?order_reference_ids"; // url => TRACK_SHIPMENT+"=order_reference_id"

export const ORDER_MANIFEST = "/v2/app/Fulfillmentservice/createManifest";

export const CREATE_SMARTR_ORDER = "https://uat.smartr.in/api/v1/add-order";
/**
 * append awbnumber
 * eg:TRACK_SMARTR_ORDER + ""=awbNumber"
 */
const TRACK_SMARTR_ORDER = "https://uat.smartr.in/api/v1/tracking/surface/?awbs";
const CANCEL_SMARTR_ORDER = "https://uat.smartr.in/api/v1/cancellation/";
/**
 * for signle apply query with key pincode=pincodeNumber
 */
const PIN_CODE = "https://uat.smartr.in/api/v1/pincode/";


/* Shiprocket API */

// export const CREATE_ORDER = "/v1/external/orders/create-order";
const CREATE_PICKUP_LOCATION = "/v1/external/settings/company/addpickup";
const CREATE_SHIPROCKET_ORDER = "/v1/external/orders/create/adhoc";
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

const APIs = {
  HUB_REGISTRATION,
  HUB_UPDATE,
  HUB_DELETE,
  CREATE_SHIPMENT,
  HUB_SERVICEABILITY,
  CANCEL_SHIPMENT,
  ORDER_REATTEMPT,
  TRACK_SHIPMENT,
  CREATE_SMARTR_ORDER,
  TRACK_SMARTR_ORDER,
  ORDER_MANIFEST,
  /**
   * append awbnumber
   * eg:TRACK_SMARTR_ORDER + ""=awbNumber"
   */
  CANCEL_SMARTR_ORDER,
  /**
   * for signle apply query with key pincode=pincodeNumber
   */
  PIN_CODE,


  CREATE_PICKUP_LOCATION,
  CREATE_SHIPROCKET_ORDER,
  LIST_SHIPROCKET_COURIER,
  GENRATE_AWB_SHIPROCKET,
  SHIPROCKET_ORDER_COURIER,
  CANCEL_SHIPMENT_SHIPROCKET,
  GET_MANIFEST_SHIPROCKET,
  SHIPROCKET_ORDER_TRACKING,
  SHIPROCKET_ORDER_NDR,

  SHOPIFY_ORDER,
  SHOPIFY_CUSTOMER
};
export default APIs;
