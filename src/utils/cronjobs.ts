// @ts-nocheck
import axios from "axios";
import { B2COrderModel } from "../models/order.model";
import config from "./config";
import APIs from "./constants/third_party_apis";
import { getDelhiveryBucketing, getDelhiveryToken, getDelhiveryToken10, getDelhiveryTokenPoint5, getSMARTRToken, getShiprocketBucketing, getShiprocketToken, getSmartRBucketing, getSmartShipToken, getSmartshipBucketing } from "./helpers";
import * as cron from "node-cron";
import EnvModel from "../models/env.model";
import https from "node:https";
import Logger from "./logger";
import { RequiredTrackResponse, TrackResponse } from "../types/b2c";
import { generateRemittanceId, getFridayDate, getNextToNextFriday, nextFriday, shipmentAmtCalcToWalletDeduction, updateSellerWalletBalance } from ".";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { CANCELED, CANCELLATION_REQUESTED_ORDER_STATUS, CANCELLED_ORDER_DESCRIPTION, DELIVERED, ORDER_TO_TRACK, RTO } from "./lorrigo-bucketing-info";
import { addDays, format, formatISO, parse, parseISO } from "date-fns";
import { getNextToNextFriday } from ".";
import fs from "fs"
import path from "path"
import { setTimeout } from 'timers/promises';


/**
 * Update order with statusCode (2) to cancelled order(3)
 * prints Error if occurred during this process
 * @returns Promise(void)
 */

const BATCH_SIZE = 130;
const API_DELAY = 120000; // 2 minutes in milliseconds
const trackedOrders = new Set();

const CANCEL_REQUESTED_ORDER_SMARTSHIP = async (): Promise<void> => {
  // get all order with statusCode 2,
  const orderUnderCancellation = await B2COrderModel.find({ bucket: CANCELLATION_REQUESTED_ORDER_STATUS });
  const order_referenceIds4smartship = orderUnderCancellation.map(
    (order) => order._id + "_" + order.order_reference_id
  );

  // hit cancellation api
  const requestBody = {
    request_info: {},
    orders: {
      client_order_reference_ids: order_referenceIds4smartship,
    },
  };
  const smartshipToken = await getSmartShipToken();
  if (!smartshipToken) {
    return Logger.warn("FAILED TO RUN JOB, SMARTSHIPTOKEN NOT FOUND");
  }
  const apiUrl = config.SMART_SHIP_API_BASEURL + APIs.CANCEL_SHIPMENT;
  const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

  const responseJSON = await (await axios.post(apiUrl, requestBody, shipmentAPIConfig)).data;

  const order_cancellation_details = responseJSON?.data?.order_cancellation_details;
  const failures = order_cancellation_details?.failure;
  let cancelled_order;
  if (failures) {
    const failureKeys = Object.keys(failures);
    cancelled_order = failureKeys
      .filter((key) => {
        return failures[key]?.message === "Already Cancelled.";
      })
      .map((key) => {
        return key.split("_")[1];
      });
  }
  // update db
  const findQuery = { order_reference_id: { $in: cancelled_order } };
  const ack = await B2COrderModel.updateMany(findQuery, { bucket: CANCELED });
  Logger.plog("cronjob executed");
  Logger.log(ack);
};

export const CONNECT_SMARTSHIP = () => {
  const requestBody = {
    username: config.SMART_SHIP_USERNAME,
    password: config.SMART_SHIP_PASSWORD,
    client_id: config.SMART_SHIP_CLIENT_ID,
    client_secret: config.SMART_SHIP_CLIENT_SECRET,
    grant_type: config.SMART_SHIP_GRANT_TYPE,
  };
  axios
    .post("https://oauth.smartship.in/loginToken.php", requestBody)
    .then((r) => {
      Logger.log("SmartShip API response: " + JSON.stringify(r.data));
      const responseBody = r.data;
      EnvModel.findOneAndUpdate(
        { name: "SMARTSHIP" },
        { $set: { nickName: "SS", token: responseBody.access_token } },
        { upsert: true, new: true }
      )
        .then(() => {
          const token = `${responseBody.token_type} ${responseBody.access_token}`;
          Logger.plog("SMARTSHIP environment updated successfully");
        })
        .catch((err) => {
          Logger.log("Error updating SMARTSHIP environment:");
          Logger.log(err);
        });
    })
    .catch((err) => {
      Logger.err("Error, smartship:" + JSON.stringify(err?.response?.data));
    });
};

export const CONNECT_SHIPROCKET = async (): Promise<void> => {
  const requestBody = {
    email: config.SHIPROCKET_USERNAME,
    password: config.SHIPROCKET_PASSWORD,
  };
  try {
    const response = await axios.post("https://apiv2.shiprocket.in/v1/external/auth/login", requestBody);
    const responseBody = response.data;

    // Update existing document or create a new one
    await EnvModel.findOneAndUpdate(
      { name: "SHIPROCKET" },
      { $set: { nickName: "SR", token: responseBody.token } },
      { upsert: true, new: true }
    );

    const token = `Bearer ${responseBody.token}`;
    Logger.plog("Shiprocket environment updated successfully");
  } catch (err) {
    console.log(err);
    Logger.err("Error connecting to Shiprocket API: ");
  }
};

/**
 * function to get SMARTR token and save it into the database
 * @return void
 */
export const CONNECT_SMARTR = async (): Promise<void> => {
  const requestBody = {
    username: config.SMARTR_USERNAME,
    password: config.SMARTR_PASSWORD,
  };

  try {
    const response = await axios.post("https://api.smartr.in/api/v1/get-token/", requestBody, {
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Set to true to verify the certificate
      }),
    });
    const responseJSON = response.data;

    if (responseJSON.success === true && responseJSON.message === "Logged In!") {
      // Update existing document or create a new one
      await EnvModel.findOneAndUpdate(
        { name: "SMARTR" },
        { $set: { nickName: "SMR", token: responseJSON.data.access_token } },
        { upsert: true, new: true }
      );

      const token = `${responseJSON.token_type} ${responseJSON.access_token}`;
      Logger.plog("SMARTR LOGGEDIN: " + JSON.stringify(responseJSON));
    } else {
      Logger.log("ERROR, smartr: " + JSON.stringify(responseJSON));
    }
  } catch (err) {
    Logger.err("SOMETHING WENT WRONG:");
    Logger.err(err);
  }
};

export const CONNECT_MARUTI = async (): Promise<void> => {
  const requestBody = {
    email: config.MARUTI_USERNAME,
    password: config.MARUTI_PASSWORD,
    vendorType: "SELLER"
  };

  try {
    const response = await axios.post("https://qaapis.delcaper.com/auth/login", requestBody);
    const responseJSON = response.data.data;
    await EnvModel.findOneAndUpdate(
      { name: "MARUTI" },
      { $set: { nickName: "MRT", token: responseJSON.accessToken, refreshToken: responseJSON.refreshToken } },
      { upsert: true, new: true }
    );

    console.log("MARUTI LOGGEDIN: " + responseJSON.accessToken);
  } catch (err) {
    console.log(err);
  }
};

// export const REFRESH_ZOHO_TOKEN = async (): Promise<void> => {
//   const requestBody = {
//     refresh_token: config.ZOHO_REFRESH_TOKEN,
//     client_id: config.ZOHO_CLIENT_ID,
//     client_secret: config.ZOHO_CLIENT_SECRET,
//     grant_type: "refresh_token",
//   };

//   try {
//     // const response = await axios.post(`https://accounts.zoho.com/oauth/v2/token?refresh_token=${requestBody.refresh_token}&client_id=${requestBody.client_id}&client_secret=${requestBody.client_secret}f&redirect_uri=http://www.lorrigo.in/books&grant_type=refresh_token`, requestBody);
//     // const responseJSON = response.data;
//     // console.log(responseJSON);
//     // await EnvModel.findOneAndUpdate(
//     //   { name: "ZOHO" },
//     //   { $set: { nickName: "ZH", token: responseJSON.access_token } },
//     //   { upsert: true, new: true }
//     // );

//     // console.log("ZOHO LOGGEDIN: " + responseJSON.access_token);
//   } catch (err) {
//     console.log(err);
//   }
// }

/**
 * function to run CronJobs currrently one cron is scheduled to update the status of order which are cancelled to "Already Cancelled".
 * @emits CANCEL_REQUESTED_ORDER
 * @returns void
 */

export const trackOrder_Smartship = async () => {

  const vendorNickname = await EnvModel.findOne({ name: "SMARTSHIP" }).select("nickName")
  const orders = await B2COrderModel.find({ bucket: { $in: ORDER_TO_TRACK }, carrierName: { $regex: vendorNickname?.nickName } });
  // const orders = await B2COrderModel.find({ awb: "77148774953" });

  // http://api.smartship.in/v1/Trackorder?tracking_numbers=${order.awb} 

  for (const orderWithOrderReferenceId of orders) {

    const smartshipToken = await getSmartShipToken();
    if (!smartshipToken) {
      Logger.warn("FAILED TO RUN JOB, SMART SHIP TOKEN NOT FOUND");
      return;
    }

    const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

    try {
      // const apiUrl = `${config.SMART_SHIP_API_BASEURL}${APIs.TRACK_SHIPMENT}=${orderWithOrderReferenceId.order_reference_id}`;
      const apiUrl = `http://api.smartship.in/v1/Trackorder?tracking_numbers=${orderWithOrderReferenceId.awb}`;
      const response = await axios.get(apiUrl, shipmentAPIConfig);
      const responseJSON: TrackResponse = response.data;

      if (responseJSON.message === "success") {
        const keys: string[] = Object.keys(responseJSON.data.scans);
        const requiredResponse: RequiredTrackResponse = responseJSON.data.scans[keys[0]][0];

        const bucketInfo = getSmartshipBucketing(Number(requiredResponse?.status_code) ?? -1);
        const orderStages = orderWithOrderReferenceId.orderStages;

        if (
          bucketInfo.bucket !== -1 &&
          orderStages.length > 0 &&
          !(orderStages[orderStages.length - 1].activity?.includes(requiredResponse.action))
        ) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.description,
            stageDateTime: formatISO(parse(requiredResponse.date_time, 'dd-MM-yyyy HH:mm:ss', new Date())),
            activity: requiredResponse.action,
            location: requiredResponse.location,
          });
          try {
            await orderWithOrderReferenceId.save();
          } catch (error) {
            console.log("Error occurred while saving order status:", error);
          }
          if (bucketInfo.bucket === RTO && orderWithOrderReferenceId.bucket !== RTO) {
            const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb)
            await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.rtoCharges, false, `${orderWithOrderReferenceId.awb} RTO charges`)
            if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb} RTO COD charges`)
          }
        }
      }
    } catch (err) {
      console.log("Error: [TrackOrder_Smartship]", err);
      Logger.err(err);
    }
  }
}

export const trackOrder_Shiprocket = async () => {
  try {
    const vendorNickname = await EnvModel.findOne({ name: "SHIPROCKET" }).select("nickName");
    if (!vendorNickname) {
      console.error("Vendor nickname not found!");
      return;
    }
    const orders = (
      await B2COrderModel.find({
        bucket: { $in: ORDER_TO_TRACK },
        carrierName: { $regex: vendorNickname.nickName },
      })
    ).reverse();

    // const orders = (
    //   await B2COrderModel.find({
    //     awb: "78068454774"
    //   })
    // ).reverse();

    const batches = [];
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      batches.push(orders.slice(i, i + BATCH_SIZE));
    }

    let batchIndex = 0;

    const processBatch = async () => {
      if (batchIndex < batches.length) {
        const batch = batches[batchIndex];
        try {
          await processShiprocketOrders(batch);
        } catch (error) {
          console.error("Error processing batch:[SHIPROKET CRON]", error);
        } finally {
          batchIndex++;
        }
      } else {
        console.log("Finished processing all batches.");
        clearInterval(intervalId);
      }
    };

    const intervalId = setInterval(async () => {
      await processBatch();
    }, API_DELAY);

    await processBatch();

  } catch (error) {
    console.error("Error tracking orders:", error);
  }
};

export const trackOrder_Smartr = async () => {
  const vendorNickname = await EnvModel.findOne({ name: "SMARTR" }).select("nickName")
  const orders = await B2COrderModel.find({ bucket: { $in: ORDER_TO_TRACK }, carrierName: { $regex: vendorNickname?.nickName } });

  for (let ordersReferenceIdOrders of orders) {
    try {

      const smartRToken = await getSMARTRToken();
      if (!smartRToken) {
        console.log("FAILED TO RUN JOB, SHIPROCKET TOKEN NOT FOUND");
        return;
      }
      const apiUrl = `${config.SMARTR_API_BASEURL}${APIs.SMARTR_TRACKING}${ordersReferenceIdOrders.awb}`;
      try {
        const res = await axios.get(apiUrl, { headers: { authorization: smartRToken } });
        if (!res.data?.success) return;
        if (res.data.data[0]) {

          const shipment_status = res.data.data[0].shipmentStatus[0]
          const bucketInfo = getSmartRBucketing(shipment_status.statusCode, shipment_status.reasonCode);
          const orderStages = ordersReferenceIdOrders.orderStages || [];

          if (
            bucketInfo.bucket !== -1 &&
            orderStages.length > 0 &&
            !(orderStages[orderStages.length - 1].activity?.includes(shipment_status.remarks))
          ) {
            console.log("Updating order with bucket info:", bucketInfo);
            ordersReferenceIdOrders.bucket = bucketInfo.bucket;
            ordersReferenceIdOrders.orderStages.push({
              stage: bucketInfo.bucket,
              action: bucketInfo.description,
              stageDateTime: new Date(),
              activity: shipment_status.remarks,
              location: shipment_status.state,
            });
            if (bucketInfo.bucket === RTO && ordersReferenceIdOrders.bucket !== RTO) {
              const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb)
              await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.rtoCharges, false, `${orderWithOrderReferenceId.awb} RTO charges`)
              if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb} RTO COD charges`)
            }
            try {
              await ordersReferenceIdOrders.save();
            } catch (error) {
              console.log("Error occurred while saving order status:", error);
            }
          }
        }
      } catch (err) {
        console.log(err);
      }

    } catch (err) {
      console.log("err", err);
    }
  }
}

export const calculateRemittanceEveryDay = async (): Promise<void> => {
  try {
    const companyName = 'L';
    const currentDate = new Date();
    const sellerIds = await SellerModel.find({}).select("_id").lean();

    for (const seller of sellerIds) {
      // Find all orders for the seller that are delivered and are COD
      const orders = await B2COrderModel.find({
        sellerId: seller._id,
        bucket: DELIVERED, // Assuming 1 represents DELIVERED
        payment_mode: 1, // COD
      }).populate("productId").lean() as OrderDocument[];

      // Check for orders already included in any remittance
      const remittedOrderIds = new Set(
        (await RemittanceModel.find({ sellerId: seller._id })
          .lean())
          .flatMap(remittance => remittance.orders)
          .map(order => order._id.toString())
      );

      // Filter out already remitted orders
      const unremittedOrders = orders.filter(order => !remittedOrderIds.has(order._id.toString()));

      // Group unremitted orders by delivery date
      const ordersGroupedByDate: { [key: string]: OrderDocument[] } = unremittedOrders.reduce((acc: { [key: string]: OrderDocument[] }, order) => {
        const deliveryDate = order.orderStages?.pop()?.stageDateTime;
        const deliveryDateOnly = format(deliveryDate, 'yyyy-MM-dd');

        if (!acc[deliveryDateOnly]) {
          acc[deliveryDateOnly] = [];
        }
        acc[deliveryDateOnly].push(order);
        return acc;
      }, {});

      for (const [deliveryDateStr, ordersOnSameDate] of Object.entries(ordersGroupedByDate)) {
        const deliveryDate = parseISO(deliveryDateStr);
        const daysSinceDelivery = Math.floor((currentDate.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
        console.log("daysSinceDelivery", daysSinceDelivery, ordersOnSameDate.map(order => order._id));

        if (daysSinceDelivery >= 7) {
          const remittanceDate = nextFriday(deliveryDate);
          const existingRemittance = await RemittanceModel.findOne({
            sellerId: seller._id,
            remittanceDate,
          }).lean();

          if (existingRemittance) {
            existingRemittance.orders.push(...ordersOnSameDate);
            existingRemittance.remittanceAmount += ordersOnSameDate.reduce((sum, order) => sum + Number(order.amount2Collect), 0);
            await RemittanceModel.updateOne({ _id: existingRemittance._id }, existingRemittance);
          } else {
            const remittanceId = generateRemittanceId(companyName, seller._id.toString(), remittanceDate);
            const remittanceAmount = ordersOnSameDate.reduce((sum, order) => sum + Number(order.amount2Collect), 0);
            const remittanceStatus = 'pending';
            const BankTransactionId = '123456789000';

            const remittance = new RemittanceModel({
              sellerId: seller._id,
              remittanceId: remittanceId,
              remittanceDate: remittanceDate,
              remittanceAmount: remittanceAmount,
              remittanceStatus: remittanceStatus,
              orders: ordersOnSameDate,
              BankTransactionId: BankTransactionId,
            });

            await remittance.save();
          }
        } else {
          const futureRemittanceDate = nextFriday(currentDate);
          if (futureRemittanceDate < deliveryDate) {
            continue;
          }
          const existingFutureRemittance = await RemittanceModel.findOne({
            sellerId: seller._id,
            remittanceDate: futureRemittanceDate,
          }).lean();

          if (existingFutureRemittance) {
            existingFutureRemittance.orders.push(...ordersOnSameDate);
            existingFutureRemittance.remittanceAmount += ordersOnSameDate.reduce((sum, order) => sum + Number(order.amount2Collect), 0);
            await RemittanceModel.updateOne({ _id: existingFutureRemittance._id }, existingFutureRemittance);
          } else {
            const remittanceId = generateRemittanceId(companyName, seller._id.toString(), futureRemittanceDate);
            const remittanceAmount = ordersOnSameDate.reduce((sum, order) => sum + Number(order.amount2Collect), 0);
            const remittanceStatus = 'pending';
            const BankTransactionId = '1234567890';

            const remittance = new RemittanceModel({
              sellerId: seller._id,
              remittanceId: remittanceId,
              remittanceDate: futureRemittanceDate,
              remittanceAmount: remittanceAmount,
              remittanceStatus: remittanceStatus,
              orders: ordersOnSameDate,
              BankTransactionId: BankTransactionId,
            });

            await remittance.save();
          }
        }
      }
    }
  } catch (error) {
    console.error(error, "{error} in calculateRemittanceEveryDay");
  }
};

export const track_delivery = async () => {
  try {
    const vendorNicknames = await EnvModel.find({ name: { $regex: "DEL" } }).select("nickName");

    for (const vendor of vendorNicknames) {

      const orders = (await B2COrderModel.find({
        bucket: { $in: ORDER_TO_TRACK },
        carrierName: { $regex: vendor?.nickName },
      })).reverse();

      for (const order of orders) {
        try {
          let delhiveryToken;

          switch (vendor.nickName) {
            case 'DEL.0.5':
              delhiveryToken = await getDelhiveryTokenPoint5();
              break;
            case 'DEL.10':
              delhiveryToken = await getDelhiveryToken10();
              break;
            default:
              delhiveryToken = await getDelhiveryToken();
              break;
          }

          const apiUrl = `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_TRACK_ORDER}${order?.awb}`;
          const res = await axios.get(apiUrl, { headers: { authorization: delhiveryToken } });

          const shipmentData = res?.data?.ShipmentData?.[0];
          if (!shipmentData || !shipmentData.Shipment?.Status) continue;

          const shipment_status = shipmentData.Shipment.Status;
          const bucketInfo = getDelhiveryBucketing(shipment_status.Status);

          const orderStages = order?.orderStages || [];
          const lastStageActivity = orderStages[orderStages.length - 1]?.activity;

          if (
            bucketInfo.bucket !== -1 &&
            orderStages.length > 0 &&
            !lastStageActivity?.includes(shipment_status.Instructions)
          ) {
            order.bucket = bucketInfo;
            order.orderStages.push({
              stage: bucketInfo,
              action: shipment_status.Status,
              stageDateTime: new Date(),
              activity: shipment_status.Instructions,
              location: shipment_status.ScannedLocation,
            });

            try {
              await order.save();
            } catch (saveError) {
              console.log("Error occurred while saving order status:", saveError);
            }

            // if (bucketInfo.bucket === RTO && orderWithOrderReferenceId.bucket !== RTO) {
            //   const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb)
            //   await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.rtoCharges, false, `${orderWithOrderReferenceId.awb} RTO charges`)
            //   if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb} RTO COD charges`)
            // }
          }
        } catch (orderError) {
          console.log("Error processing order:", orderError);
        }
      }
    }
  } catch (err) {
    console.log("Error fetching vendors or processing orders:", err);
  }
};

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

async function fetchAndSaveData() {
  try {
    // Make the API request
    const delhiveryToken = await getDelhiveryTokenPoint5();

    const apiUrl = `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_TRACK_ORDER}9145210460073`;
    const response = await axios.get(apiUrl, { headers: { authorization: delhiveryToken } });

    const data = response.data;

    ensureDirectoryExistence('delhivery-0.5-tracking.json');
    fs.writeFileSync("delhivery-0.5-tracking.json", JSON.stringify(data, null, 2), 'utf8');
  } catch (error: any) {
    console.error('Error fetching data:', error.message);
  }
}

export default async function runCron() {
  console.log("Running cron scheduler");
  track_delivery()
  const expression4every2Minutes = "*/2 * * * *";
  const expression4every30Minutes = "*/30 * * * *";
  if (cron.validate(expression4every2Minutes)) {
    cron.schedule(expression4every30Minutes, await trackOrder_Shiprocket);  // Track order status every 30 minutes
    cron.schedule(expression4every30Minutes, track_delivery);  // Track order status every 30 minutes
    cron.schedule(expression4every30Minutes, fetchAndSaveData);  // Track order status every 30 minutes
    cron.schedule(expression4every2Minutes, trackOrder_Smartship);
    cron.schedule(expression4every2Minutes, trackOrder_Smartr);

    const expression4every5Minutes = "*/5 * * * *";
    const expression4every59Minutes = "59 * * * *";
    const expression4every9_59Hr = "59 9 * * *";
    const expression4everyFriday = "0 0 * * 5";

    cron.schedule(expression4every9_59Hr, fetchAndSaveData);
    cron.schedule(expression4every9_59Hr, calculateRemittanceEveryDay);
    cron.schedule(expression4every59Minutes, CONNECT_SHIPROCKET);
    cron.schedule(expression4every59Minutes, CONNECT_SMARTSHIP);
    cron.schedule(expression4every5Minutes, CANCEL_REQUESTED_ORDER_SMARTSHIP);
    cron.schedule(expression4every9_59Hr, CONNECT_SMARTR);

    Logger.log("Cron jobs scheduled successfully");
  } else {
    Logger.log("Invalid cron expression");
  }
}

const processShiprocketOrders = async (orders) => {
  for (const orderWithOrderReferenceId of orders) {
    if (trackedOrders.has(orderWithOrderReferenceId.awb)) {
      continue;
    }

    try {
      const shiprocketToken = await getShiprocketToken();
      if (!shiprocketToken) {
        console.log("FAILED TO RUN JOB, SHIPROCKET TOKEN NOT FOUND");
        return;
      }

      const apiUrl = `${config.SHIPROCKET_API_BASEURL}${APIs.SHIPROCKET_ORDER_TRACKING}/${orderWithOrderReferenceId.awb}`;
      const response = await axios.get(apiUrl, {
        headers: {
          Authorization: shiprocketToken
        }
      });

      if (response.data.tracking_data.shipment_status) {
        const bucketInfo = getShiprocketBucketing(Number(response.data.tracking_data.shipment_status));
        if (
          bucketInfo.bucket !== -1 &&
          orderWithOrderReferenceId.orderStages.length > 0 &&
          !(orderWithOrderReferenceId.orderStages[orderWithOrderReferenceId.orderStages.length - 1].activity?.includes(response.data.tracking_data?.shipment_track_activities[0]?.activity))
        ) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.description,
            activity: response.data.tracking_data?.shipment_track_activities[0]?.activity,
            location: response.data.tracking_data?.shipment_track_activities[0]?.location,
            stageDateTime: formatISO(parse(response?.data?.tracking_data?.shipment_track_activities?.[0]?.date, 'yyyy-MM-dd HH:mm:ss', new Date())),
          });
          try {
            await orderWithOrderReferenceId.save();
          } catch (error) {
            console.log("Error occurred while saving order status:", error);
          }


          if (bucketInfo.bucket === RTO && orderWithOrderReferenceId.bucket !== RTO) {
            const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb);
            await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges?.rtoCharges, false, `${orderWithOrderReferenceId.awb} RTO charges`);
            if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb} RTO COD charges`);
          }
        }

        trackedOrders.add(orderWithOrderReferenceId.awb);
      }
    } catch (err: any) {
      console.log(err, "SHIPROCKET ERROR TRACKING ORDER");
      // Logger.err(err);
    }
  }
};