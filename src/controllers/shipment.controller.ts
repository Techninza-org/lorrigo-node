import { type Response, type NextFunction } from "express";
import {
  getDelhiveryToken,
  getDelhiveryToken10,
  getDelhiveryTokenPoint5,
  getSMARTRToken,
  getSellerChannelConfig,
  getShiprocketToken,
  getSmartShipToken,
  isValidPayload,
} from "../utils/helpers";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import { Types, isValidObjectId } from "mongoose";
import axios from "axios";
import config from "../utils/config";
import APIs from "../utils/constants/third_party_apis";
import EnvModel from "../models/env.model";
import type { ExtendedRequest } from "../utils/middleware";
import ProductModel from "../models/product.model";
import ShipmentResponseModel from "../models/shipment-response.model";
import CourierModel from "../models/courier.model";
import HubModel from "../models/hub.model";
import Logger from "../utils/logger";
import https from "node:https";
import { OrderPayload } from "../types/b2b";
import {
  calculateAverageShippingCost,
  calculateCODDetails,
  calculateNDRDetails,
  calculateRevenue,
  calculateShipmentDetails,
  createDelhiveryShipment,
  handleSmartShipShipment,
  sendMailToScheduleShipment,
  shipmentAmtCalcToWalletDeduction,
  shiprocketShipment,
  smartRShipment,
  updateOrderStatus,
  updateSellerWalletBalance,
} from "../utils";
import { format, parse, parseISO, } from "date-fns";
import { CANCELED, CANCELLED_ORDER_DESCRIPTION, SMARTSHIP_COURIER_ASSIGNED_ORDER_STATUS, COURRIER_ASSIGNED_ORDER_DESCRIPTION, IN_TRANSIT, MANIFEST_ORDER_DESCRIPTION, NDR, NEW, NEW_ORDER_DESCRIPTION, READY_TO_SHIP, SHIPMENT_CANCELLED_ORDER_DESCRIPTION, SHIPMENT_CANCELLED_ORDER_STATUS, SMARTSHIP_MANIFEST_ORDER_STATUS, SMARTSHIP_ORDER_REATTEMPT_DESCRIPTION, SMARTSHIP_ORDER_REATTEMPT_STATUS, SMARTSHIP_SHIPPED_ORDER_DESCRIPTION, SMARTSHIP_SHIPPED_ORDER_STATUS, SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, PICKUP_SCHEDULED_DESCRIPTION, SHIPROCKET_MANIFEST_ORDER_STATUS, DELIVERED, RETURN_CONFIRMED } from "../utils/lorrigo-bucketing-info";
import ClientBillingModal from "../models/client.billing.modal";
import envConfig from "../utils/config";
import SellerModel from "../models/seller.model";

// TODO: REMOVE THIS CODE: orderType = 0 ? "b2c" : "b2b"
export async function createShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    const seller = req.seller;
    const sellerId = req.seller._id;

    if (seller.config.isPrepaid && (body.charge >= seller.walletBalance || seller.walletBalance < 0)) {
      return res.status(200).send({ valid: false, message: "Insufficient wallet balance, Please Recharge your waller!" });
    }

    if (!isValidPayload(body, ["orderId", "orderType", "carrierId", "carrierNickName", "charge"])) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }
    if (!isValidObjectId(body?.orderId)) return res.status(200).send({ valid: false, message: "Invalid orderId" });
    if (body.orderType !== 0) return res.status(200).send({ valid: false, message: "Invalid orderType" });

    if (req.seller?.gstno) return res.status(200).send({ valid: false, message: "KYC required. (GST number) " });

    let order;
    try {
      order = await B2COrderModel.findOne({ _id: body.orderId, sellerId: req.seller._id });
      if (!order) return res.status(200).send({ valid: false, message: "order not found" });
    } catch (err) {
      return next(err);
    }
    let hubDetails;
    try {
      hubDetails = await HubModel.findById(order.pickupAddress);
      if (!hubDetails) return res.status(200).send({ valid: false, message: "Hub details not found" });
    } catch (err) {
      return next(err);
    }
    let productDetails;
    try {
      productDetails = await ProductModel.findById(order.productId);
      if (!productDetails) {
        return res.status(200).send({ valid: false, message: "Product details not found" });
      }
    } catch (err) {
      return next(err);
    }

    const vendorName = await EnvModel.findOne({ nickName: body.carrierNickName });

    const courier = await CourierModel.findOne({ vendor_channel_id: vendorName?._id.toString() });

    if (vendorName?.name === "SMARTSHIP") {
      const smartShipCourier = await CourierModel.findById(body.carrierId);
      const productValueWithTax =
        Number(productDetails.taxable_value) +
        (Number(productDetails.tax_rate) / 100) * Number(productDetails.taxable_value);

      const totalOrderValue = productValueWithTax * Number(productDetails.quantity);

      const isReshipedOrder =
        order.orderStages.find((stage: any) => stage.stage === SHIPMENT_CANCELLED_ORDER_STATUS)?.action ===
        SHIPMENT_CANCELLED_ORDER_DESCRIPTION;

      let lastNumber = order?.client_order_reference_id?.match(/\d+$/)?.[0] || "";

      let incrementedNumber = lastNumber ? (parseInt(lastNumber) + 1).toString() : "1";

      let newString = `${order?.client_order_reference_id?.replace(/\d+$/, "")}_R${incrementedNumber}`;

      const client_order_reference_id = isReshipedOrder ? newString : `${order?.order_reference_id}`;

      let orderWeight = order?.orderWeight * 1000;

      console.log(smartShipCourier?.carrierID)


      const shipmentAPIBody = {
        request_info: {
          run_type: "create",
          shipment_type: order.isReverseOrder ? 2 : 1, // 1 => forward, 2 => return order
        },
        orders: [
          {
            "client_order_reference_id": client_order_reference_id,
            "shipment_type": order.isReverseOrder ? 2 : 1,
            "order_collectable_amount": order.payment_mode === 1 ? order.amount2Collect : 0, // need to take  from user in future,
            "total_order_value": totalOrderValue,
            "payment_type": order.payment_mode ? "cod" : "prepaid",
            "package_order_weight": orderWeight,
            "package_order_length": order.orderBoxLength,
            "package_order_height": order.orderBoxWidth,
            "package_order_width": order.orderBoxHeight,
            "shipper_hub_id": hubDetails.hub_id,
            "shipper_gst_no": req.seller.gstno,
            "order_invoice_date": order?.order_invoice_date,
            "order_invoice_number": order?.order_invoice_number || "Non-commercial",
            // "is_return_qc": "1",
            // "return_reason_id": "0",
            order_meta: {
              preferred_carriers: [smartShipCourier?.carrierID || ""],
            },
            product_details: [
              {
                client_product_reference_id: "something",
                product_name: productDetails?.name,
                product_category: productDetails?.category,
                product_hsn_code: productDetails?.hsn_code || "0000",
                product_quantity: productDetails?.quantity,
                product_invoice_value: 11234,
                product_gst_tax_rate: productDetails.tax_rate,
                product_taxable_value: productDetails.taxable_value,
                // "product_sgst_amount": "2",
                // "product_sgst_tax_rate": "2",
                // "product_cgst_amount": "2",
                // "product_cgst_tax_rate": "2"
              },
            ],
            consignee_details: {
              consignee_name: order.customerDetails.get("name"),
              consignee_phone: order.customerDetails?.get("phone"),
              consignee_email: order.customerDetails.get("email"),
              consignee_complete_address: order.customerDetails.get("address"),
              consignee_pincode: order.customerDetails.get("pincode"),
            },
          },
        ],
      };

      let smartshipToken;
      try {
        smartshipToken = await getSmartShipToken();
        if (!smartshipToken) return res.status(200).send({ valid: false, message: "Invalid token" });
      } catch (err) {
        return next(err);
      }
      let externalAPIResponse: any;
      try {
        const requestConfig = { headers: { Authorization: smartshipToken } };
        const response = await axios.post(
          config.SMART_SHIP_API_BASEURL + APIs.CREATE_SHIPMENT,
          shipmentAPIBody,
          requestConfig
        );
        externalAPIResponse = response.data;
      } catch (err: unknown) {
        return next(err);
      }

      if (externalAPIResponse?.status === "403") {
        return res.status(500).send({ valid: true, message: "Smartship ENVs is expired." });
      }
      if (!externalAPIResponse?.data?.total_success_orders) {
        return res
          .status(200)
          .send({ valid: false, message: "Courier Not Serviceable!", smartship: externalAPIResponse });
      } else {
        const shipmentResponseToSave = new ShipmentResponseModel({ order: order._id, response: externalAPIResponse });
        try {
          const savedShipmentResponse = await shipmentResponseToSave.save();
          const awbNumber = externalAPIResponse?.data?.success_order_details?.orders[0]?.awb_number;
          console.log("[SmartShip createShipment controller] awbNumber", externalAPIResponse?.data?.success_order_details?.orders[0]);
          if (!awbNumber) {
            return res.status(200).send({ valid: false, message: "Please choose another courier partner!" });
          }
          const carrierName = smartShipCourier?.name + " " + vendorName?.nickName;
          order.client_order_reference_id = client_order_reference_id;
          order.shipmentCharges = body.charge;
          order.bucket = order.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
          order.orderStages.push({
            stage: SMARTSHIP_COURIER_ASSIGNED_ORDER_STATUS,
            action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
            stageDateTime: new Date(),
          });
          order.awb = awbNumber;
          order.carrierName = carrierName;
          const updatedOrder = await order.save();

          if (order.channelName === "shopify") {
            try {
              const shopfiyConfig = await getSellerChannelConfig(sellerId);
              const shopifyOrders = await axios.get(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );

              const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

              const shopifyFulfillment = {
                fulfillment: {
                  line_items_by_fulfillment_order: [
                    {
                      fulfillment_order_id: fulfillmentOrderId,
                    },
                  ],
                  tracking_info: {
                    company: carrierName,
                    number: awbNumber,
                    url: `https://lorrigo.in/track/${order?._id}`,
                  },
                },
              };

              const shopifyFulfillmentResponse = await axios.post(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
                shopifyFulfillment,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );

              order.channelFulfillmentId = fulfillmentOrderId;
              await order.save();
            } catch (error) {
              console.log("Error[shopify]", error);
            }
          }

          await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);

          return res.status(200).send({ valid: true, order: updatedOrder, shipment: savedShipmentResponse });
        } catch (err) {
          console.log(err, "error")
          return next(err);
        }
      }
      return res.status(500).send({ valid: false, message: "something went wrong", order, externalAPIResponse });
    } else if (vendorName?.name === "SHIPROCKET") {
      try {
        const shiprocketCourier = await CourierModel.findById(body.carrierId);

        const shiprocketToken = await getShiprocketToken();

        const genAWBPayload = {
          shipment_id: order.shiprocket_shipment_id,
          courier_id: shiprocketCourier?.carrierID.toString(),
          is_return: order.isReverseOrder ? 1 : 0,
        }
        try {
          const awbResponse = await axios.post(
            config.SHIPROCKET_API_BASEURL + APIs.GENRATE_AWB_SHIPROCKET,
            genAWBPayload,
            {
              headers: {
                Authorization: shiprocketToken,
              },
            }
          );

          let awb = awbResponse?.data?.response?.data?.awb_code || awbResponse?.data?.response?.data?.awb_assign_error?.split("-")[1].split(" ")[1];

          if (!awb) {
            return res
              .status(200)
              .send({ valid: false, message: "Internal Server Error, Please use another courier partner" });
          }

          order.awb = awb;
          order.carrierName = (shiprocketCourier?.name) + " " + (vendorName?.nickName);
          order.shipmentCharges = body.charge;
          order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
          order.orderStages.push({
            stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS,
            action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
            stageDateTime: new Date(),
          });

          await order.save();

          let fulfillmentOrderId: string = "";
          try {
            if (order.channelName === "shopify") {
              const shopfiyConfig = await getSellerChannelConfig(sellerId);
              const shopifyOrders = await axios.get(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );

              fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

              const shopifyFulfillment = {
                fulfillment: {
                  line_items_by_fulfillment_order: [
                    {
                      fulfillment_order_id: fulfillmentOrderId,
                    },
                  ],
                  tracking_info: {
                    company: awbResponse?.data?.response?.data?.awb_code,
                    number: awbResponse?.data?.response?.data.courier_name + " " + vendorName?.nickName,
                    url: `https://lorrigo.in/track/${order?._id}`,
                  },
                },
              };
              const shopifyFulfillmentResponse = await axios.post(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
                shopifyFulfillment,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );
            }
          } catch (error: any) {
            console.log("Error[shopify]", error?.response?.data?.errors);
          }

          order.channelFulfillmentId = fulfillmentOrderId;
          await order.save();
          await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          return res.status(200).send({ valid: true, order });
        } catch (error: any) {
          console.log(error, "error");
          return next(error);
        }
      } catch (error: any) {
        console.log(error, "error");
        return next(error);
      }
    } else if (vendorName?.name === "SMARTR") {
      const smartrToken = await getSMARTRToken();
      if (!smartrToken) return res.status(200).send({ valid: false, message: "Invalid token" });

      const smartrShipmentPayload = [{
        packageDetails: {
          awbNumber: "",
          orderNumber: order.client_order_reference_id,
          productType: order.payment_mode ? "ACC" : "ACP",
          collectableValue: order.payment_mode ? order.amount2Collect : 0,
          declaredValue: productDetails.taxable_value,
          itemDesc: productDetails.name,
          dimensions: `${order.orderBoxLength}~${order.orderBoxWidth}~${order.orderBoxHeight}~${productDetails.quantity}~${order.orderWeight}~0 /`, // LBH-No. of pieces~Weight~0/
          pieces: productDetails.quantity,
          weight: order.orderWeight,
          invoiceNumber: order.order_invoice_number,
        },
        deliveryDetails: {
          toName: order.customerDetails.get("name"),
          toAdd: order.customerDetails.get("address"),
          toCity: order.customerDetails.get("city"),
          toState: order.customerDetails.get("state"),
          toPin: order.customerDetails.get("pincode"),
          // @ts-ignore
          toMobile: order.customerDetails.get("phone").toString().toString().replaceAll(' ', '').slice(3, 13),
          toEmail: order.customerDetails.get("email") || "noreply@lorrigo.com",
          toAddType: "Home", // Mendatory 
          toLat: order.customerDetails.get("lat") || "",
          toLng: order.customerDetails.get("lng") || "",
        },
        pickupDetails: {
          fromName: hubDetails.name,
          fromAdd: hubDetails.address1,
          fromCity: hubDetails.city,
          fromState: hubDetails.state,
          fromPin: hubDetails.pincode,
          fromMobile: hubDetails.phone.toString().slice(-10),
          fromEmail: "",
          fromLat: "",
          fromLng: "",
          fromAddType: "Seller", // Mendatory
        },
        returnDetails: {
          rtoName: hubDetails.name,
          rtoAdd: hubDetails.rtoAddress || hubDetails.address1, // Mendatory
          rtoCity: hubDetails.rtoCity || hubDetails.city, // Mendatory
          rtoState: hubDetails.rtoState || hubDetails.state, // Mendatory
          rtoPin: hubDetails.rtoPincode || hubDetails.pincode, // Mendatory
          rtoMobile: hubDetails.phone.toString().slice(-10),
          rtoEmail: "",
          rtoAddType: "Seller", // Mendatory
          rtoLat: "",
          rtoLng: "",
        },
        additionalInformation: {
          customerCode: "DELLORRIGO001",
          essentialFlag: "",
          otpFlag: "",
          dgFlag: "",
          isSurface: true,
          isReverse: false,
          sellerGSTIN: req.seller.gstno || "", // Mendatory
          sellerERN: "",
        },
      }];

      try {
        let config = {
          method: "post",
          maxBodyLength: Infinity,
          url: "https://api.smartr.in/api/v1/add-order/",
          headers: {
            'Authorization': smartrToken,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify(smartrShipmentPayload),
        };

        const axisoRes = await axios.request(config);
        const smartRShipmentResponse = axisoRes.data;


        let orderAWB = smartRShipmentResponse.total_success[0]?.awbNumber;
        if (orderAWB === undefined) {
          orderAWB = smartRShipmentResponse.total_failure[0]?.awbNumber
        }
        order.awb = orderAWB;
        order.shipmentCharges = body.charge;
        order.carrierName = courier?.name + " " + (vendorName?.nickName);


        if (orderAWB) {
          order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
          order.orderStages.push({
            stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS,  // Evantuallly change this to SMARTRd_COURIER_ASSIGNED_ORDER_STATUS
            action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
            stageDateTime: new Date(),
          });

          try {
            if (order.channelName === "shopify") {
              const shopfiyConfig = await getSellerChannelConfig(sellerId);
              const shopifyOrders = await axios.get(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );

              const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

              const shopifyFulfillment = {
                fulfillment: {
                  line_items_by_fulfillment_order: [
                    {
                      fulfillment_order_id: fulfillmentOrderId,
                    },
                  ],
                  tracking_info: {
                    company: orderAWB,
                    number: courier?.name + " " + (vendorName?.nickName),
                    url: `https://lorrigo.in/track/${order?._id}`,
                  },
                },
              };
              const shopifyFulfillmentResponse = await axios.post(
                `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
                shopifyFulfillment,
                {
                  headers: {
                    "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                  },
                }
              );
              order.channelFulfillmentId = fulfillmentOrderId;
            }
          } catch (error: any) {
            console.log("Error[shopify]", error?.response?.data?.errors);
          }

          await order.save();

          await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          return res.status(200).send({ valid: true, order });
        }
        return res.status(401).send({ valid: false, message: "Please choose another courier partner!" });

      } catch (error) {
        console.error("Error creating SMARTR shipment:", error);
        return next(error);
      }
    } else if (vendorName?.name === "DELHIVERY") {
      const delhiveryToken = await await getDelhiveryToken();
      if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

      const delhiveryShipmentPayload = {
        format: "json",
        data: {
          shipments: [
            {
              name: order.customerDetails.get("name"),
              add: order.customerDetails.get("address"),
              pin: order.customerDetails.get("pincode"),
              city: order.customerDetails.get("city"),
              state: order.customerDetails.get("state"),
              country: "India",
              phone: order.customerDetails.get("phone"),
              order: order.client_order_reference_id,
              payment_mode: order?.isReverseOrder ? "Pickup" : order.payment_mode ? "COD" : "Prepaid",
              return_pin: hubDetails.rtoPincode,
              return_city: hubDetails.rtoCity,
              return_phone: hubDetails.phone,
              return_add: hubDetails.rtoAddress || hubDetails.address1,
              return_state: hubDetails.rtoState || hubDetails.state,
              return_country: "India",
              products_desc: productDetails.name,
              hsn_code: productDetails.hsn_code,
              cod_amount: order.payment_mode ? order.amount2Collect : 0,
              order_date: order.order_invoice_date,
              total_amount: productDetails.taxable_value,
              seller_add: hubDetails.address1,
              seller_name: hubDetails.name,
              seller_inv: order.order_invoice_number,
              quantity: productDetails?.quantity,
              waybill: order.ewaybill || "",
              shipment_length: order.orderBoxLength,
              shipment_width: order.orderBoxWidth,
              shipment_height: order.orderBoxHeight,
              weight: order.orderWeight * 1000,
              seller_gst_tin: req.seller.gstno,
              shipping_mode: "Surface",
              address_type: "home",
            },
          ],
          pickup_location: {
            name: hubDetails.name,
            add: hubDetails.address1,
            city: hubDetails.city,
            pin_code: hubDetails.pincode,
            country: "India",
            phone: hubDetails.phone,
          },
        },
      };

      const urlEncodedPayload = `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryShipmentPayload.data))}`;

      try {
        const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CREATE_ORDER}`, urlEncodedPayload, {
          headers: {
            Authorization: delhiveryToken,
          },
        });

        const delhiveryShipmentResponse = response.data;
        const delhiveryRes = delhiveryShipmentResponse?.packages[0]

        if (!delhiveryRes?.status) {
          return res.status(200).send({ valid: false, message: "Must Select the Delhivery Registered Hub" });
        }

        order.awb = delhiveryRes?.waybill;
        order.carrierName = courier?.name + " " + (vendorName?.nickName);
        order.shipmentCharges = body.charge;
        order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_STATUS
          action: COURRIER_ASSIGNED_ORDER_DESCRIPTION, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_DESCRIPTION
          stageDateTime: new Date(),
        }, {
          stage: SMARTSHIP_MANIFEST_ORDER_STATUS,
          action: MANIFEST_ORDER_DESCRIPTION,
          stageDateTime: new Date(),
        }, {
          stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
          action: PICKUP_SCHEDULED_DESCRIPTION,
          stageDateTime: new Date(),
        }
        );

        try {
          if (order.channelName === "shopify") {
            const shopfiyConfig = await getSellerChannelConfig(sellerId);
            const shopifyOrders = await axios.get(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );

            const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

            const shopifyFulfillment = {
              fulfillment: {
                line_items_by_fulfillment_order: [
                  {
                    fulfillment_order_id: fulfillmentOrderId,
                  },
                ],
                tracking_info: {
                  company: delhiveryRes?.waybill,
                  number: courier?.name + " " + (vendorName?.nickName),
                  url: `https://lorrigo.in/track/${order?._id}`,
                },
              },
            };
            const shopifyFulfillmentResponse = await axios.post(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
              shopifyFulfillment,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );
            order.channelFulfillmentId = fulfillmentOrderId;
          }
        } catch (error) {
          console.log("Error[shopify]", error);
        }

        await order.save();
        await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${delhiveryRes?.waybill}, ${order.payment_mode ? "COD" : "Prepaid"}`);
        return res.status(200).send({ valid: true, order });
      } catch (error) {
        console.error("Error creating Delhivery shipment:", error);
        return next(error);
      }

    } else if (vendorName?.name === "DELHIVERY_0.5") {
      const delhiveryToken = await getDelhiveryTokenPoint5();
      if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

      const delhiveryShipmentPayload = {
        format: "json",
        data: {
          shipments: [
            {
              name: order.customerDetails.get("name"),
              add: order.customerDetails.get("address"),
              pin: order.customerDetails.get("pincode"),
              city: order.customerDetails.get("city"),
              state: order.customerDetails.get("state"),
              country: "India",
              phone: order.customerDetails.get("phone"),
              order: order.client_order_reference_id,
              payment_mode: order?.isReverseOrder ? "Pickup" : order.payment_mode ? "COD" : "Prepaid",
              return_pin: hubDetails.rtoPincode,
              return_city: hubDetails.rtoCity,
              return_phone: hubDetails.phone,
              return_add: hubDetails.rtoAddress || hubDetails.address1,
              return_state: hubDetails.rtoState || hubDetails.state,
              return_country: "India",
              products_desc: productDetails.name,
              hsn_code: productDetails.hsn_code,
              cod_amount: order.payment_mode ? order.amount2Collect : 0,
              order_date: order.order_invoice_date,
              total_amount: productDetails.taxable_value,
              seller_add: hubDetails.address1,
              seller_name: hubDetails.name,
              seller_inv: order.order_invoice_number,
              quantity: productDetails.quantity,
              waybill: order.ewaybill || "",
              shipment_length: order.orderBoxLength,
              shipment_width: order.orderBoxWidth,
              shipment_height: order.orderBoxHeight,
              weight: order.orderWeight * 1000, // convert to grams
              seller_gst_tin: req.seller.gstno,
              shipping_mode: "Surface",
              address_type: "home",
            },
          ],
          pickup_location: {
            name: hubDetails.name,
            add: hubDetails.address1,
            city: hubDetails.city,
            pin_code: hubDetails.pincode,
            country: "India",
            phone: hubDetails.phone,
          },
        },
      };

      const urlEncodedPayload = `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryShipmentPayload.data))}`;

      try {
        const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CREATE_ORDER}`, urlEncodedPayload, {
          headers: {
            Authorization: delhiveryToken,
          },
        });

        const delhiveryShipmentResponse = response.data;
        const delhiveryRes = delhiveryShipmentResponse?.packages[0]

        if (!delhiveryRes?.status) {
          return res.status(200).send({ valid: false, message: "Must Select the Delhivery Registered Hub" });
        }

        order.awb = delhiveryRes?.waybill;
        order.carrierName = courier?.name + " " + (vendorName?.nickName);
        order.shipmentCharges = body.charge;
        order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_STATUS
          action: COURRIER_ASSIGNED_ORDER_DESCRIPTION, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_DESCRIPTION
          stageDateTime: new Date(),
        }, {
          stage: SMARTSHIP_MANIFEST_ORDER_STATUS,
          action: MANIFEST_ORDER_DESCRIPTION,
          stageDateTime: new Date(),
        }, {
          stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
          action: PICKUP_SCHEDULED_DESCRIPTION,
          stageDateTime: new Date(),
        }
        );

        try {
          if (order.channelName === "shopify") {
            const shopfiyConfig = await getSellerChannelConfig(sellerId);
            const shopifyOrders = await axios.get(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );

            const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

            const shopifyFulfillment = {
              fulfillment: {
                line_items_by_fulfillment_order: [
                  {
                    fulfillment_order_id: fulfillmentOrderId,
                  },
                ],
                tracking_info: {
                  company: delhiveryRes?.waybill,
                  number: courier?.name + " " + (vendorName?.nickName),
                  url: `https://lorrigo.in/track/${order?._id}`,
                },
              },
            };
            const shopifyFulfillmentResponse = await axios.post(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
              shopifyFulfillment,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );
            order.channelFulfillmentId = fulfillmentOrderId;
          }
        } catch (error) {
          console.log("Error[shopify]", error);
        }

        await order.save();
        await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${delhiveryRes?.waybill}, ${order.payment_mode ? "COD" : "Prepaid"}`);
        return res.status(200).send({ valid: true, order });
      } catch (error) {
        console.error("Error creating Delhivery shipment:", error);
        return next(error);
      }

    } else if (vendorName?.name === "DELHIVERY_10") {
      const deliveryCourier = await CourierModel.findById(body.carrierId);

      const delhiveryToken = await getDelhiveryToken10();
      if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

      const delhiveryShipmentPayload = {
        format: "json",
        data: {
          shipments: [
            {
              name: order.customerDetails.get("name"),
              add: order.customerDetails.get("address"),
              pin: order.customerDetails.get("pincode"),
              city: order.customerDetails.get("city"),
              state: order.customerDetails.get("state"),
              country: "India",
              phone: order.customerDetails.get("phone"),
              order: order.client_order_reference_id,
              payment_mode: order?.isReverseOrder ? "Pickup" : order.payment_mode ? "COD" : "Prepaid",
              return_pin: hubDetails.rtoPincode,
              return_city: hubDetails.rtoCity,
              return_phone: hubDetails.phone,
              return_add: hubDetails.rtoAddress || hubDetails.address1,
              return_state: hubDetails.rtoState || hubDetails.state,
              return_country: "India",
              products_desc: productDetails.name,
              hsn_code: productDetails.hsn_code,
              cod_amount: order.payment_mode ? order.amount2Collect : 0,
              order_date: order.order_invoice_date,
              total_amount: productDetails.taxable_value,
              seller_add: hubDetails.address1,
              seller_name: hubDetails.name,
              seller_inv: order.order_invoice_number,
              quantity: productDetails.quantity,
              waybill: order.ewaybill || "",
              shipment_length: order.orderBoxLength,
              shipment_width: order.orderBoxWidth,
              shipment_height: order.orderBoxHeight,
              weight: order.orderWeight * 1000,
              seller_gst_tin: req.seller.gstno,
              shipping_mode: "Surface",
              address_type: "home",
            },
          ],
          pickup_location: {
            name: hubDetails.name,
            add: hubDetails.address1,
            city: hubDetails.city,
            pin_code: hubDetails.pincode,
            country: "India",
            phone: hubDetails.phone,
          },
        },
      };

      const urlEncodedPayload = `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryShipmentPayload.data))}`;

      try {
        const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CREATE_ORDER}`, urlEncodedPayload, {
          headers: {
            Authorization: delhiveryToken,
          },
        });

        const delhiveryShipmentResponse = response.data;
        const delhiveryRes = delhiveryShipmentResponse?.packages[0]


        if (!delhiveryRes?.status) {
          return res.status(200).send({ valid: false, message: "Must Select the Delhivery Registered Hub" });
        }

        order.awb = delhiveryRes?.waybill;
        order.carrierName = deliveryCourier?.name + " " + (vendorName?.nickName);
        order.shipmentCharges = body.charge;
        order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_STATUS
          action: COURRIER_ASSIGNED_ORDER_DESCRIPTION, // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_DESCRIPTION
          stageDateTime: new Date(),
        }, {
          stage: SMARTSHIP_MANIFEST_ORDER_STATUS,
          action: MANIFEST_ORDER_DESCRIPTION,
          stageDateTime: new Date(),
        }, {
          stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
          action: PICKUP_SCHEDULED_DESCRIPTION,
          stageDateTime: new Date(),
        }
        );

        try {
          if (order.channelName === "shopify") {
            const shopfiyConfig = await getSellerChannelConfig(sellerId);
            const shopifyOrders = await axios.get(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT_ORDER}/${order.channelOrderId}/fulfillment_orders.json`,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );

            const fulfillmentOrderId = shopifyOrders?.data?.fulfillment_orders[0]?.id;

            const shopifyFulfillment = {
              fulfillment: {
                line_items_by_fulfillment_order: [
                  {
                    fulfillment_order_id: fulfillmentOrderId,
                  },
                ],
                tracking_info: {
                  company: delhiveryRes?.waybill,
                  number: courier?.name + " " + (vendorName?.nickName),
                  url: `https://lorrigo.in/track/${order?._id}`,
                },
              },
            };
            const shopifyFulfillmentResponse = await axios.post(
              `${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_FULFILLMENT}`,
              shopifyFulfillment,
              {
                headers: {
                  "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
                },
              }
            );
            order.channelFulfillmentId = fulfillmentOrderId;
          }
        } catch (error) {
          console.log("Error[shopify]", error);
        }

        await order.save();
        await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${delhiveryRes?.waybill}, ${order.payment_mode ? "COD" : "Prepaid"}`)
        return res.status(200).send({ valid: true, order });
      } catch (error) {
        console.error("Error creating Delhivery shipment:", error);
        return next(error);
      }

    } else if (vendorName?.name === "ECOMM") {

    }
  } catch (error) {
    return next(error);
  }
}

export async function createBulkShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    const seller = req.seller;
    const sellerId = req.seller._id;

    if (seller.config.isPrepaid && (body.charge >= seller.walletBalance || seller.walletBalance < 0)) {
      return res.status(200).send({ valid: false, message: "Insufficient wallet balance, Please Recharge your waller!" });
    }

    if (!isValidPayload(body, ["orderIds", "orderType", "carrierId", "carrierNickName", "charge"])) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }
    if (!Array.isArray(body.orderIds) || body.orderIds.some((orderId: string) => !isValidObjectId(orderId))) {
      return res.status(200).send({ valid: false, message: "Invalid orderIds" });
    }
    if (body.orderType !== 0) return res.status(200).send({ valid: false, message: "Invalid orderType" });

    // if (!req.seller?.gstno) return res.status(200).send({ valid: false, message: "KYC required. (GST number) " });

    const vendorName = await EnvModel.findOne({ nickName: body.carrierNickName });
    if (!vendorName) return res.status(200).send({ valid: false, message: "Invalid carrierNickName" });

    const courier = await CourierModel.findOne({ vendor_channel_id: vendorName?._id.toString() });
    if (!courier) return res.status(200).send({ valid: false, message: "Courier not found" });

    const results = [];
    for (const orderId of body.orderIds) {
      try {
        const order = await B2COrderModel.findOne({ _id: orderId, sellerId });
        if (!order) {
          results.push({ orderId, valid: false, message: "Order not found" });
          continue;
        }

        const hubDetails = await HubModel.findById(order.pickupAddress);
        if (!hubDetails) {
          results.push({ orderId, valid: false, message: "Hub details not found" });
          continue;
        }

        const productDetails = await ProductModel.findById(order.productId);
        if (!productDetails) {
          results.push({ orderId, valid: false, message: "Product details not found" });
          continue;
        }

        let shipmentResponse;
        if (vendorName.name === "SMARTSHIP") {
          shipmentResponse = await handleSmartShipShipment({
            sellerId,
            sellerGST: req.seller.gstno,
            vendorName,
            charge: body.charge,
            order,
            carrierId: body.carrierId,
            hubDetails,
            productDetails,
          });
        } else if (vendorName.name === "SHIPROCKET") {
          shipmentResponse = await shiprocketShipment({
            sellerId,
            vendorName,
            charge: body.charge,
            order,
            carrierId: body.carrierId,
          });
        } else if (vendorName.name === "SMARTR") {
          shipmentResponse = await smartRShipment({
            sellerId,
            sellerGST: req.seller.gstno,
            vendorName,
            courier,
            charge: body.charge,
            order,
            carrierId: body.carrierId,
            hubDetails,
            productDetails,
          });
        } else if (["DELHIVERY", "DELHIVERY_0.5", "DELHIVERY_10"].includes(vendorName.name)) {
          shipmentResponse = await createDelhiveryShipment({
            sellerId,
            vendorName,
            courier,
            body,
            order,
            hubDetails,
            productDetails,
            sellerGST: req.seller.gstno,
          });
        } else {
          // results.push({ orderId, valid: false, message: "Unsupported vendor" });
          continue;
        }

        results.push({ orderId, valid: true, shipmentResponse });
      } catch (error) {
        results.push({ orderId, valid: false, message: "Error creating shipment", error });
      }
    }

    return res.status(200).send({ valid: true, results });

  } catch (error) {
    console.log(error)
    return next(error);
  }
}

export async function cancelShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const { orderIds, type } = req.body;
    const sellerId = req.seller._id;

    if (!orderIds?.length) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }

    const [b2cOrders, b2bOrders] = await Promise.all([
      B2COrderModel.find({ _id: { $in: orderIds }, sellerId }),
      B2BOrderModel.find({ _id: { $in: orderIds }, sellerId })
    ]);

    // Merge the results
    const orders: any = [...b2cOrders, ...b2bOrders];

    if (!orders.length) {
      return res.status(200).send({ valid: false, message: "No active orders found" });
    }

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];

      if (!order.awb && type === "order") {
        // @ts-ignore
        await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
        await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
        continue;
      }

      const assignedVendorNickname = order.carrierName ? order.carrierName.split(" ").pop() : null;
      const vendorName = await EnvModel.findOne({ nickName: assignedVendorNickname });

      if (order.bucket === IN_TRANSIT) {
        const rtoCharges = await shipmentAmtCalcToWalletDeduction(order.awb) ?? { rtoCharges: 0, cod: 0 };
        console.log(rtoCharges, "rtoCharges")
        await updateSellerWalletBalance(sellerId, rtoCharges?.rtoCharges || 0, false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
        if (!!rtoCharges.cod) await updateSellerWalletBalance(sellerId, rtoCharges.cod || 0, true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
      }

      if (vendorName?.name === "SMARTSHIP") {
        const smartshipToken = await getSmartShipToken();
        if (!smartshipToken) {
          return res.status(500).send({ valid: false, message: "Smartship environment variables not found" });
        }

        const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

        let requestBody = {
          request_info: {},
          orders: {
            client_order_reference_ids: [order.client_order_reference_id],
          },
        };

        try {
          const externalAPIResponse = await axios.post(
            config.SMART_SHIP_API_BASEURL + APIs.CANCEL_SHIPMENT,
            requestBody,
            shipmentAPIConfig
          );

          if (externalAPIResponse.data.status === "403") {
            return res.status(500).send({ valid: false, message: "Smartship environment variables expired" });
          }

          const orderCancellationDetails = externalAPIResponse.data?.data?.order_cancellation_details;

          if (orderCancellationDetails?.failure) {
            const failureMessage =
              externalAPIResponse?.data?.data?.order_cancellation_details?.failure[order?.order_reference_id]?.message;
            if (failureMessage?.includes("Already Cancelled.")) {
              // Order already cancelled
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);

              return res.status(200).send({ valid: false, message: "Order already cancelled" });
            } else if (failureMessage?.includes("Cancellation already requested.")) {
              // Cancellation already requested
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);

              return res.status(200).send({ valid: false, message: "Cancellation already requested" });
            } else {
              return res
                .status(500)
                .send({ valid: false, message: "Incomplete route section", orderCancellationDetails });
            }
          } else {
            if (type === "order") {
              // @ts-ignore
              await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
            } else {
              order.awb = null;
              order.carrierName = null;
              order.save();

              await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
              await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);
              // @ts-ignore
              await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
            }

            return res.status(200).send({ valid: true, message: "Order cancellation request generated" });
          }
        } catch (error) {
          return next(error);
        }
      } else if (vendorName?.name === "SHIPROCKET") {
        try {
          const cancelShipmentPayload = {
            awbs: [order.awb],
          };
          const shiprocketToken = await getShiprocketToken();
          const cancelShipmentResponse = await axios.post(
            config.SHIPROCKET_API_BASEURL + APIs.CANCEL_SHIPMENT_SHIPROCKET,
            cancelShipmentPayload,
            {
              headers: {
                Authorization: shiprocketToken,
              },
            }
          );
          if (type === "order") {
            await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
          } else {
            order.awb = null;
            order.carrierName = null;
            order.save();

            await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
            await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);
          }
          // @ts-ignore
          await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          return res.status(200).send({ valid: true, message: "Order cancellation request generated" });
        } catch (error) {
          return next(error);
        }
      } else if (vendorName?.name === "SMARTR") {
        const smartrToken = await getSMARTRToken();
        if (!smartrToken) return res.status(200).send({ valid: false, message: "Invalid token" });

        if (type === "order") {
          // @ts-ignore
          await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
        } else {

          const cancelOrder = await axios.post(config.SMARTR_API_BASEURL + APIs.CANCEL_ORDER_SMARTR, {
            awbs: [order.awb],
          }, {
            headers: {
              Authorization: smartrToken,
            },
          }
          )
          const response = cancelOrder?.data
          console.log(response, "response")
          const isCancelled = response.data[0].success;
          if (isCancelled) {
            order.awb = null;
            order.carrierName = null
            await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
            await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);
            // @ts-ignore
            await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
            order.save();
          }
        }
      }
      else if (vendorName?.name === "DELHIVERY") {
        const delhiveryToken = await getDelhiveryToken();
        if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

        const cancelShipmentPayload = {
          waybill: order.awb,
          cancellation: true
        };

        try {
          const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CANCEL_ORDER}`, cancelShipmentPayload, {
            headers: {
              Authorization: delhiveryToken,
            },
          });

          const delhiveryShipmentResponse = response.data;

          console.log(delhiveryShipmentResponse, "delhiveryShipmentResponse")

          if (delhiveryShipmentResponse.status) {
            if (type === "order") {
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
            } else {
              order.awb = null;
              order.carrierName = null
              order.save();

              await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
              await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);

            }
            // @ts-ignore
            await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          }
          return res.status(200).send({ valid: true, message: "Order cancellation request generated" });

        } catch (error) {
          console.error("Error creating Delhivery shipment:", error);
          return next(error);
        }
      }
      else if (vendorName?.name === "DELHIVERY_0.5") {
        const delhiveryToken = await getDelhiveryTokenPoint5();
        if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

        const cancelShipmentPayload = {
          waybill: order.awb,
          cancellation: true
        };

        try {
          const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CANCEL_ORDER}`, cancelShipmentPayload, {
            headers: {
              Authorization: delhiveryToken,
            },
          });

          const delhiveryShipmentResponse = response.data;

          if (delhiveryShipmentResponse.status) {
            if (type === "order") {
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
            } else {
              order.awb = null;
              order.carrierName = null
              order.save();

              await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
              await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);

            }
            // @ts-ignore
            await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          }
          return res.status(200).send({ valid: true, message: "Order cancellation request generated" });

        } catch (error) {
          console.error("Error creating Delhivery shipment:", error);
          return next(error);
        }
      }
      else if (vendorName?.name === "DELHIVERY_10") {
        const delhiveryToken = await getDelhiveryToken10();
        if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

        const cancelShipmentPayload = {
          waybill: order.awb,
          cancellation: true
        };

        try {
          const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_CANCEL_ORDER}`, cancelShipmentPayload, {
            headers: {
              Authorization: delhiveryToken,
            },
          });

          const delhiveryShipmentResponse = response.data;

          if (delhiveryShipmentResponse.status) {
            if (type === "order") {
              await updateOrderStatus(order._id, CANCELED, CANCELLED_ORDER_DESCRIPTION);
            } else {
              order.awb = null;
              order.carrierName = null
              order.save();

              await updateOrderStatus(order._id, SHIPMENT_CANCELLED_ORDER_STATUS, SHIPMENT_CANCELLED_ORDER_DESCRIPTION);
              await updateOrderStatus(order._id, NEW, NEW_ORDER_DESCRIPTION);

            }
            // @ts-ignore
            await updateSellerWalletBalance(req.seller._id, Number(order.shipmentCharges ?? 0), true, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
          }
          return res.status(200).send({ valid: true, message: "Order cancellation request generated" });

        } catch (error) {
          console.error("Error creating Delhivery shipment:", error);
          return next(error);
        }
      }
    }

    return res.status(200).send({ valid: true, message: "Order cancellation request generated" });
  } catch (error) {
    console.log(error, 'erroe')
    return next(error);
  }
}

export async function orderManifest(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    const { orderId, pickupDate } = body;

    if (!(orderId && isValidObjectId(orderId))) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }

    let order: any;
    try {
      order = await B2COrderModel.findOne({ _id: orderId, sellerId: req.seller._id }).populate(["productId", "pickupAddress"]);
    } catch (err) {
      return next(err);
    }

    if (!order) order = await B2BOrderModel.findOne({ _id: orderId, sellerId: req.seller._id }).populate(["customer", "pickupAddress"]);

    if (!order) return res.status(200).send({ valid: false, message: "Order not found" });

    const assignedVendorNickname = order.carrierName ? order.carrierName.split(" ").pop() : null;

    const vendorName = await EnvModel.findOne({ nickName: assignedVendorNickname });

    if (vendorName?.name === "SMARTSHIP") {
      const smartshipToken = await getSmartShipToken();
      if (!smartshipToken) return res.status(200).send({ valid: false, message: "Smartship ENVs not found" });

      const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

      const requestBody = {
        client_order_reference_ids: [order._id + "_" + order.order_reference_id],
        preferred_pickup_date: pickupDate.replaceAll(" ", "-"),
        shipment_type: (order.isReverseOrder ? 2 : 1),
      };

      order.bucket = READY_TO_SHIP;
      order.orderStages.push({
        stage: SMARTSHIP_MANIFEST_ORDER_STATUS,
        action: MANIFEST_ORDER_DESCRIPTION,
        stageDateTime: new Date(),
      });

      order.bucket = READY_TO_SHIP;
      order.orderStages.push({
        stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
        action: PICKUP_SCHEDULED_DESCRIPTION,
        stageDateTime: new Date(),
      });

      await order.save();

      try {
        const externalAPIResponse = await axios.post(
          config.SMART_SHIP_API_BASEURL + APIs.ORDER_MANIFEST,
          requestBody,
          shipmentAPIConfig
        );

        if (externalAPIResponse.data.status === "403") {
          return res.status(500).send({ valid: false, message: "Smartships ENVs expired" });
        }

        const order_manifest_details = externalAPIResponse.data?.data;

        if (order_manifest_details?.failure) {
          return res.status(200).send({ valid: false, message: "Incomplete route", order_manifest_details });
        } else {
          return res
            .status(200)
            .send({ valid: true, message: "Order manifest request generated", order_manifest_details });
        }
      } catch (error) {
        return next(error);
      }
    } else if (vendorName?.name === "SHIPROCKET") {
      const shiprocketToken = await getShiprocketToken();

      const parsedDate = parse(pickupDate, "yyyy MM dd", new Date());

      const formattedDate = format(parsedDate, "yyyy-MM-dd");

      const schdulePickupPayload = {
        shipment_id: [order.shiprocket_shipment_id],
        pickup_date: [formattedDate],
      };
      try {
        const schduleRes = await axios.post(
          config.SHIPROCKET_API_BASEURL + APIs.GET_MANIFEST_SHIPROCKET,
          schdulePickupPayload,
          {
            headers: {
              Authorization: shiprocketToken,
            },
          }
        );
      } catch (error) {
        return next(error);
      }

      try {
        order.bucket = READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_MANIFEST_ORDER_STATUS,
          action: PICKUP_SCHEDULED_DESCRIPTION,
          stageDateTime: new Date(),
        });

        await order.save();

        return res.status(200).send({ valid: true, message: "Order manifest request generated" });
      } catch (error) {
        return next(error);
      }
    } else if (vendorName?.name === "SMARTR") {
      const smartrToken = await getSMARTRToken();
      if (!smartrToken) return res.status(200).send({ valid: false, message: "Invalid token" });
      const isEmailSend = await sendMailToScheduleShipment({ orders: [order], pickupDate });

      // Need to iz
      try {
        order.bucket = READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_MANIFEST_ORDER_STATUS,   // Evantuallly change this to SMARTR_COURIER_ASSIGNED_ORDER_STATUS
          action: PICKUP_SCHEDULED_DESCRIPTION,
          stageDateTime: new Date(),
        });

        await order.save();

        return res.status(200).send({ valid: true, message: "Order manifest request generated" });

      } catch (error) {
        return next(error);
      }

      return res.status(200).send({ valid: true, message: "Order manifest request generated", isEmailSend });

    } else if (vendorName?.name === "DELHIVERY") {

      // Delhiery Manifest is not working
      const hubDetail = await HubModel.findById(order?.pickupAddress);
      if (!hubDetail) return res.status(200).send({ valid: false, message: "Hub not found" });
      const delhiveryToken = await getDelhiveryToken();
      if (!delhiveryToken) return res.status(200).send({ valid: false, message: "Invalid token" });

      const delhiveryManifestPayload = {
        pickup_location: hubDetail?.name,
        expected_package_count: 1,
        pickup_date: pickupDate.replaceAll(" ", "-"),
        pickup_time: "12:23:00",
      };

      console.log(delhiveryManifestPayload, "delhiveryManifestPayload")

      try {
        const response = await axios.post(`${envConfig.DELHIVERY_API_BASEURL + APIs.DELHIVERY_MANIFEST_ORDER}`, delhiveryManifestPayload, {
          headers: {
            Authorization: delhiveryToken,
          },
        });

        const delhiveryManifestResponse = response.data;
        console.log(delhiveryManifestResponse, "delhiveryManifestResponse")

        if (delhiveryManifestResponse.status) {
          order.bucket = READY_TO_SHIP;
          order.orderStages.push({
            stage: SHIPROCKET_MANIFEST_ORDER_STATUS,  // Evantuallly change this to DELHIVERY_COURIER_ASSIGNED_ORDER_STATUS
            action: MANIFEST_ORDER_DESCRIPTION,
            stageDateTime: new Date(),
          });

          await order.save();

          return res.status(200).send({ valid: true, message: "Order manifest request generated" });
        }
      }
      catch (error) {
        console.error("Error creating Delhivery shipment:", error);
        return next(error);
      }
    }

  } catch (error) {
    console.log(error)
    return next(error);
  }
}

export async function orderReattempt(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    const {
      orderId,
      ndrInfo: { rescheduleDate, comment, contact, address, name },
      type,
    } = body;

    if (!(orderId && isValidObjectId(orderId))) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }

    let order;
    try {
      order = await B2COrderModel.findOne({ _id: orderId, sellerId: req.seller._id });
    } catch (err) {
      return next(err);
    }

    if (!order) return res.status(200).send({ valid: false, message: "Order not found" });

    const carrierName = order.carrierName ? order.carrierName.split(" ").pop() : null;

    const vendorName = await EnvModel.findOne({ nickName: carrierName });

    if (vendorName?.name === "SMARTSHIP") {
      const smartshipToken = await getSmartShipToken();
      if (!smartshipToken) return res.status(200).send({ valid: false, message: "Smartship ENVs not found" });

      const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };
      const requestBody = {
        orders: [
          {
            // request_order_id: 10977589,   // Yes, if client_order_reference_id not provied
            action_id: type === "re-attempt" ? 1 : 2, // 1 --> reattempt, 2 --> rto
            names: name,
            phone: contact,
            comments: comment,
            next_attempt_date: format(rescheduleDate, "yyyy-MM-dd"),
            client_order_reference_id: [order.client_order_reference_id],
            address: address,
          },
        ],
      };

      try {
        const externalAPIResponse = await axios.post(
          config.SMART_SHIP_API_BASEURL + APIs.ORDER_REATTEMPT,
          requestBody,
          shipmentAPIConfig
        );

        if (externalAPIResponse.data.status === "403") {
          return res.status(500).send({ valid: false, message: "Smartships ENVs expired" });
        }

        const order_reattempt_details = externalAPIResponse?.data?.data;
        if (order_reattempt_details?.failure) {
          return res.status(200).send({ valid: false, message: "Incomplete route", order_reattempt_details });
        } else {
          return res
            .status(200)
            .send({ valid: true, message: "Order reattempt request generated", order_reattempt_details });
        }
        await updateOrderStatus(order._id, NDR, SMARTSHIP_ORDER_REATTEMPT_DESCRIPTION);
        return res.status(200).send({ valid: true, message: "Order reattempt request generated" });
      } catch (error) {
        return next(error);
      }
    } else if (vendorName?.name === "SHIPROCKET") {
      const shiprocketToken = await getShiprocketToken();

      interface OrderReattemptPayload {
        action: "fake-attempt" | "re-attempt" | "return";
        comment?: string;
      }

      const orderReattemptPayload: OrderReattemptPayload = {
        action: type,
        comment: comment,
      };
      try {
        const schduleRes = await axios.post(
          config.SHIPROCKET_API_BASEURL + APIs.SHIPROCKET_ORDER_NDR + `/${order.awb}/action`,
          orderReattemptPayload,
          {
            headers: {
              Authorization: shiprocketToken,
            },
          }
        );

        await updateOrderStatus(order._id, NDR, SMARTSHIP_ORDER_REATTEMPT_DESCRIPTION);
        return res.status(200).send({ valid: true, message: "Order reattempt request generated" });
      } catch (error) {
        return next(error);
      }
    }
  } catch (error) {
    return next(error);
  }
}

/**
 *
 * @param ExtendedRequest
 * @param Response
 * @param NextFunction
 * @author kapilrohilla, Alok Sharma
 * @body {orderId: string}
 * @returns
 */
export async function createB2BShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body;

    const sellerId = req.seller._id;
    const seller = await SellerModel.findById(sellerId).select("gst").lean();

    if (!isValidPayload(body, ["orderId"])) return res.status(200).send({ valid: false, message: "Invalid payload" });
    if (!isValidObjectId(body?.orderId)) return res.status(200).send({ valid: false, message: "invalid orderId" });

    const order: any | null = await B2BOrderModel.findOne({ _id: body?.orderId, sellerId }) //OrderPayload
      .populate("customer")
      .populate("pickupAddress")
    if (!order) return res.status(200).send({ valid: false, message: "order not found" });

    const vendorName = await EnvModel.findOne({ nickName: body.carrierNickName });
    const courier = await CourierModel.findOne({ vendor_channel_id: vendorName?._id.toString() });

    const smartr_token = await getSMARTRToken();
    if (!smartr_token) return res.status(500).send({ valid: false, message: "SMARTR token not found" });

    let dimensions = order?.packageDetails
      ?.map((item: any) => {
        return `${item?.orderBoxLength}~${item?.orderBoxWidth}~${item?.orderBoxHeight}~${item.qty}~${item?.orderBoxWeight}~0/`;
      })
      .join("");

    let data = [
      {
        packageDetails: {
          awbNumber: "",
          orderNumber: order?.order_reference_id,
          productType: "WKO", // WKO for surface bookings
          collectableValue: 0 + "",
          declaredValue: order?.amount + "",
          itemDesc: order?.product_description,
          dimensions: dimensions,
          pieces: order?.quantity + "",
          weight: order?.total_weight + "",
          invoiceNumber: order.invoiceNumber + "",
        },
        deliveryDetails: {
          toName: order.customer?.name ?? "",
          toAdd: order.customer?.address ?? "",
          toCity: order.customer?.city ?? "",
          toState: order.customer?.state ?? "",
          toPin: order.customer?.pincode + "",
          toMobile: (order.customer?.phone).substring(3),
          toAddType: "Home",
          toLat: "26.00",
          toLng: "78.00",
          toEmail: order.customer?.email ?? "",
        },
        pickupDetails: {
          fromName: order.pickupAddress?.name,
          fromAdd: order.pickupAddress?.address1,
          fromCity: order.pickupAddress?.city,
          fromState: order.pickupAddress?.state,
          fromPin: order.pickupAddress?.pincode + "",
          fromMobile: (order.pickupAddress?.phone).substring(2),
          fromAddType: "Hub",
          fromLat: "26.00",
          fromLng: "78.00",
          fromEmail: order.pickupAddress?.email ?? "",
        },
        returnDetails: {
          rtoName: order.pickupAddress?.name,
          rtoAdd: order.pickupAddress?.address1,
          rtoCity: order.pickupAddress?.city,
          rtoState: order.pickupAddress?.state,
          rtoPin: order.pickupAddress?.pincode + "",
          rtoMobile: (order.pickupAddress?.phone).substring(2),
          rtoAddType: "Hub",
          rtoLat: "26.00",
          rtoLng: "78.00",
          rtoEmail: order.pickupAddress?.email ?? "",
        },
        additionalInformation: {
          customerCode: envConfig.SMARTR_USERNAME,
          essentialFlag: "",
          otpFlag: "",
          dgFlag: "",
          isSurface: "true",
          isReverse: "false",
          sellerGSTIN: seller?.gst ?? "",
          sellerERN: "",
        },
      },
    ];

    let config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.smartr.in/api/v1/add-order/",
      headers: {
        Authorization: `${smartr_token}`,
        "Content-Type": "application/json",
      },
      data: JSON.stringify(data),
    };

    try {
      const axisoRes = await axios.request(config);
      const smartRShipmentResponse = axisoRes.data;

      let orderAWB = smartRShipmentResponse.total_success[0]?.awbNumber;
      if (orderAWB === undefined) {
        orderAWB = smartRShipmentResponse.total_failure[0]?.awbNumber
      }
      order.awb = orderAWB;
      order.shipmentCharges = body.charge;
      order.carrierName = courier?.name + " " + (vendorName?.nickName);

      console.log(orderAWB, "orderAWB")

      if (orderAWB) {
        order.bucket = order?.isReverseOrder ? RETURN_CONFIRMED : READY_TO_SHIP;
        order.orderStages.push({
          stage: SHIPROCKET_COURIER_ASSIGNED_ORDER_STATUS,  // Evantuallly change this to SMARTRd_COURIER_ASSIGNED_ORDER_STATUS
          action: COURRIER_ASSIGNED_ORDER_DESCRIPTION,
          stageDateTime: new Date(),
        });
        await order.save();
        await updateSellerWalletBalance(req.seller._id, Number(body.charge), false, `AWB: ${order.awb}, ${order.payment_mode ? "COD" : "Prepaid"}`);
        return res.status(200).send({ valid: true, order });
      }
      return res.status(401).send({ valid: false, message: "Please choose another courier partner!" });

    } catch (error) {
      console.error("Error creating SMARTR shipment:", error);
      return next(error);
    }

    return res.status(500).send({ valid: false, message: "Incomplete route" });
  } catch (error) {
    return next(error);
  }
}

export async function trackB2BShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  const smartr_token = await getSMARTRToken();
  if (!smartr_token) {
    return res.status(500).send({ valid: false, message: "SMARTr token not found" });
  }
  const apiConfig = {
    headers: { Authorization: smartr_token },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false, // set true to verify ssl certificate
    }),
  };
  try {

  } catch (err: unknown) {
    return next(err);
  }
}

export async function cancelB2BShipment(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const smartr_token = await getSMARTRToken();
    if (!smartr_token) {
      return res.status(500).send({ valid: false, message: "SMARTr token not found" });
    }
    const apiPayload = [
      {
        waybillNumber: "SLAWB00269",
        WaybillStatus: "Cancelled",
        cancelledRemarks: "Dont want",
      },
    ];

    const apiConfig = {
      headers: { Authorization: smartr_token },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    };
    let responseJSON: { awb: string; message: string; success: boolean }[];
    try {

    } catch (err) {
      return next(err);
    }

  } catch (error) {
    return next(error);
  }
}

export async function getShipemntDetails(req: ExtendedRequest, res: Response, next: NextFunction) {
  try {
    const sellerID = req.seller._id.toString();
    const currentDate = new Date();

    // Calculate last 30 days from today
    const date30DaysAgo = new Date(currentDate);
    date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);

    // Calculate start and end of today
    const startOfToday = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const endOfToday = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);

    // Calculate start and end of yesterday
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setDate(endOfYesterday.getDate() + 1);

    // Fetch today's and yesterday's orders
    const [orders, todayOrders, yesterdayOrders, remittanceCODOrders] = await Promise.all([
      B2COrderModel.find({
        sellerId: sellerID,
        createdAt: { $gte: date30DaysAgo, $lt: currentDate }
      }),
      B2COrderModel.find({ sellerId: sellerID, createdAt: { $gte: startOfToday, $lt: endOfToday } }),
      B2COrderModel.find({ sellerId: sellerID, createdAt: { $gte: startOfYesterday, $lt: endOfYesterday } }),
      ClientBillingModal.find({
        sellerId: sellerID,
        createdAt: { $gte: date30DaysAgo, $lt: currentDate }
      }),

    ]);
    // Extract shipment details
    const shipmentDetails = calculateShipmentDetails(orders);

    // Calculate NDR details
    const NDRDetails = calculateNDRDetails(orders);

    // Calculate COD details
    const CODDetails = calculateCODDetails(remittanceCODOrders);

    // Calculate today's and yesterday's revenue and average shipping cost
    const todayRevenue = calculateRevenue(todayOrders);
    const yesterdayRevenue = calculateRevenue(yesterdayOrders);
    const todayAverageShippingCost = calculateAverageShippingCost(todayOrders);
    const yesterdayAverageShippingCost = calculateAverageShippingCost(yesterdayOrders);

    const todayYesterdayAnalysis = {
      todayOrdersCount: todayOrders.length,
      yesterdayOrdersCount: yesterdayOrders.length,
      todayRevenue,
      yesterdayRevenue,
      todayAverageShippingCost,
      yesterdayAverageShippingCost,
    };

    return res.status(200).json({ shipmentDetails, NDRDetails, CODDetails, todayYesterdayAnalysis });
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong" });
  }
}
