import { type Response, type NextFunction } from "express";
import {
  getDelhiveryToken,
  getDelhiveryToken10,
  getDelhiveryTokenPoint5,
  getMarutiToken,
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
      const smartshipShipment = await handleSmartShipShipment({
        sellerId: req.seller._id,
        sellerGST: req.seller.gstno,
        vendorName,
        charge: body.charge,
        order: order,
        carrierId: body.carrierId,
        hubDetails,
        productDetails,
      })
      return res.status(200).send({ valid: true, order, smartshipShipment });

    } else if (vendorName?.name === "SHIPROCKET") {

      const shiprocketOrderShipment = await shiprocketShipment({
        sellerId: req.seller._id,
        vendorName,
        charge: body.charge,
        order: order,
        carrierId: body.carrierId,
      })

      return res.status(200).send({ valid: true, order: shiprocketOrderShipment });

    } else if (vendorName?.name === "SMARTR") {
      try {
        const smartrOrderShipment = await smartRShipment({
          sellerId: req.seller._id,
          sellerGST: req.seller.gstno,
          vendorName,
          courier,
          charge: body.charge,
          order: order,
          carrierId: body.carrierId,
          hubDetails,
          productDetails,
        })
        return res.status(200).send({ valid: true, order: smartrOrderShipment });
      } catch (error) {
        return res.status(500).send({ valid: false, message: "Error creating shipment", error });
      }
    } else if (["DELHIVERY", "DELHIVERY_0.5", "DELHIVERY_10"].includes(vendorName?.name ?? "")) {
      const delhiveryOrderShipment = await createDelhiveryShipment({
        sellerId: req.seller._id,
        vendorName,
        courier,
        body,
        order,
        hubDetails,
        productDetails,
        sellerGST: req.seller.gstno,

      })
      console.log(delhiveryOrderShipment, "delhiveryOrderShipment")
      return res.status(200).send({ valid: true, order: delhiveryOrderShipment });
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

        results.push({ orderId, valid: true,  shipmentResponse });
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
