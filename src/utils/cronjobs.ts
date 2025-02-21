// @ts-nocheck
import axios from "axios";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import config from "./config";
import APIs from "./constants/third_party_apis";
import { generateAccessToken, getB2BShiprocketBucketing, getDelhiveryBucketing, getDelhiveryToken, getDelhiveryToken10, getDelhiveryTokenPoint5, getSMARTRToken, getShiprocketB2BConfig, getShiprocketBucketing, getShiprocketToken, getSmartRBucketing, getSmartShipToken, getSmartshipBucketing, handleDateFormat, modifyPdf } from "./helpers";
import * as cron from "node-cron";
import EnvModel from "../models/env.model";
import https from "node:https";
import Logger from "./logger";
import { RequiredTrackResponse, TrackResponse } from "../types/b2c";
import { cancelOrderShipment, formatCurrencyForIndia, generateListInoviceAwbs, generateRemittanceId, getFridayDate, getNextToNextFriday, shipmentAmtCalcToWalletDeduction, updateSellerWalletBalance } from ".";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { CANCELED, CANCELLATION_REQUESTED_ORDER_STATUS, CANCELLED_ORDER_DESCRIPTION, DELIVERED, ORDER_TO_TRACK, RTO, SHIPROCKET_MANIFEST_ORDER_STATUS } from "./lorrigo-bucketing-info";
import { addDays, format, formatISO, parse, isFriday, nextFriday, parseISO, differenceInCalendarDays } from "date-fns";
import fs from "fs"
import path from "path"
import { setTimeout } from 'timers/promises';
import envConfig from "../utils/config";
import ClientBillingModal from "../models/client.billing.modal";
import { paymentStatusInfo } from "./recharge-wallet-info";
import InvoiceModel from "../models/invoice.model";
import PaymentTransactionModal from "../models/payment.transaction.modal";
import emailService from "./email.service";

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

    await EnvModel.findOneAndUpdate(
      { name: "SHIPROCKET" },
      { $set: { token: responseBody.token } },
      { upsert: true, new: true }
    );

    const token = `Bearer ${responseBody.token}`;
    Logger.plog("Shiprocket environment updated successfully");
  } catch (err) {
    console.log(err);
    Logger.err("Error connecting to Shiprocket API: ");
  }
};

export const CONNECT_SHIPROCKET_B2B = async (): Promise<void> => {
  try {
    const existingEnv = await EnvModel.findOne({ name: "SHIPROCKET_B2B" });
    const refreshToken = existingEnv ? existingEnv.refreshToken : null;

    if (!refreshToken) {
      throw new Error('Refresh token not available. Please login first.');
    }

    const requestBody = {
      refresh: refreshToken,
    };

    const response = await axios.post(
      'https://api-cargo.shiprocket.in/api/token/refresh/',
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${refreshToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const responseBody = response.data;

    if (!responseBody || !responseBody.access) {
      throw new Error('Failed to refresh token');
    }

    await EnvModel.findOneAndUpdate(
      { name: "SHIPROCKET_B2B" },
      {
        $set: {
          nickName: "SR_B2B",
          token: responseBody.access,
          refreshToken: responseBody.refresh,  // assuming refresh token might get updated
        },
      },
      { upsert: true, new: true }
    );

    const token = `Bearer ${responseBody.access}`;

    Logger.plog("Shiprocket token refreshed successfully");
  } catch (err: any) {
    console.error(err);
    Logger.err("Error refreshing Shiprocket token: ", err.message);
  }
};

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

// TODO: Need fixes in this function
export const CONNECT_MARUTI = async (): Promise<void> => {
  try {
    const response = await axios.get(`${envConfig.MARUTI_BASEURL}${APIs.MARUTI_ACCESS}`, {
      headers: {
        Authorization: `Bearer ${config.MARUTI_REFRESH_TOKEN}`,
      },
    });
    const accessToken = response.data.data.accessToken;
    await EnvModel.findOneAndUpdate(
      { name: "MARUTI" },
      { $set: { nickName: "MRT", token: accessToken } },
      { upsert: true, new: true }
    );
    console.log("MARUTI LOGGEDIN: " + accessToken);
  } catch (err) {
    console.log(err);
  }
}

export const REFRESH_ZOHO_TOKEN = async (): Promise<void> => {
  const data = {
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  }

  try {
    const response = await axios.post("https://accounts.zoho.in/oauth/v2/token", data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    await EnvModel.findOneAndUpdate(
      { name: "ZOHO" },
      { $set: { nickName: "ZH", token: response.data.access_token } },
      { upsert: true, new: true }
    );

    console.log("ZOHO LOGGEDIN: " + response.data.access_token);
  } catch (err) {
    console.log(err);
  }
}

export const trackOrder_Smartship = async () => {

  const vendorNickname = await EnvModel.findOne({ name: "SMARTSHIP" }).select("nickName")
  const orders = await B2COrderModel.find({ bucket: { $in: ORDER_TO_TRACK }, carrierName: { $regex: vendorNickname?.nickName } });

  const smartshipToken = await getSmartShipToken();
  if (!smartshipToken) {
    Logger.warn("FAILED TO RUN JOB, SMART SHIP TOKEN NOT FOUND");
    return;
  }
  const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

  for (const orderWithOrderReferenceId of orders) {
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
          orderStages[orderStages.length - 1].location !== requiredResponse.location // as smartship change 
        ) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.bucket === RTO ? `RTO ${bucketInfo.description}` : bucketInfo.description,
            stageDateTime: handleDateFormat(requiredResponse.date_time ?? ""),
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
            await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.rtoCharges, false, `${orderWithOrderReferenceId.awb}, RTO charges`)
            if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb}, RTO COD charges`)
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
    const vendorNickname = await EnvModel.findOne({ name: "SHIPROCKET" }).select("nickName _id");
    if (!vendorNickname) {
      console.error("Vendor nickname not found!");
      return;
    }
    const orders = (
      await B2COrderModel.find({
        bucket: { $in: ORDER_TO_TRACK },
        $or: [
          { carrierName: { $regex: vendorNickname.nickName } },
          { carrierId: vendorNickname._id },
        ],
      })
    ).reverse();

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
  const vendorNickname = await EnvModel.findOne({ name: "SMARTR" }).select("nickName") // Replace SMARTSHIP, SHIPROCKET etc with SMARTR
  const orders = await B2COrderModel.find({ bucket: { $in: ORDER_TO_TRACK }, carrierName: { $regex: vendorNickname?.nickName } }); // vendorNickname.nickName: SS, SR, SMR etc

  const smartRToken = await getSMARTRToken();
  if (!smartRToken) {
    console.log("FAILED TO RUN JOB, smartRToken TOKEN NOT FOUND");
    return;
  }

  for (let ordersReferenceIdOrders of orders) {
    try {
      const apiUrl = `${config.SMARTR_API_BASEURL}${APIs.SMARTR_TRACKING}${ordersReferenceIdOrders.awb}`;

      try {
        const res = await axios.get(apiUrl, { headers: { Authorization: `${smartRToken}` } });
        if (!res.data?.success) return;
        if (res.data.data[0]) {

          const shipment_status = res.data.data[0].shipmentStatus[0]
          const bucketInfo = getSmartRBucketing(shipment_status.statusCode, shipment_status.reasonCode);
          const orderStages = ordersReferenceIdOrders.orderStages || [];

          if (
            bucketInfo.bucket !== -1 &&
            orderStages.length > 0 &&
            !orderStages[orderStages.length - 1].action?.includes(bucketInfo.description) &&
            !(orderStages[orderStages.length - 1].activity?.includes(shipment_status.remarks))
          ) {
            console.log("Updating order with bucket info:", bucketInfo);
            ordersReferenceIdOrders.bucket = bucketInfo.bucket;
            ordersReferenceIdOrders.orderStages.push({
              stage: bucketInfo.bucket,
              action: bucketInfo.bucket === RTO ? `RTO ${bucketInfo.description}` : bucketInfo.description,
              stageDateTime: new Date(),
              activity: shipment_status.remarks,
              location: shipment_status.state,
            });
            if (bucketInfo.bucket === RTO && ordersReferenceIdOrders.bucket !== RTO) {
              const rtoCharges = await shipmentAmtCalcToWalletDeduction(ordersReferenceIdOrders.awb)
              await updateSellerWalletBalance(ordersReferenceIdOrders.sellerId, rtoCharges.rtoCharges, false, `${ordersReferenceIdOrders.awb}, RTO charges`)
              if (rtoCharges.cod) await updateSellerWalletBalance(ordersReferenceIdOrders.sellerId, rtoCharges.cod, true, `${ordersReferenceIdOrders.awb}, RTO COD charges`)
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

// limit the query required
export const calculateRemittanceEveryDay = async (): Promise<void> => {
  try {
    const companyName = 'L';
    const currMonth = new Date();
    currMonth.setDate(1);
    currMonth.setHours(0, 0, 0, 0);

    const sellerIds = await SellerModel.find({}).select('_id').lean();

    for (const seller of sellerIds) {
      const orders = await B2COrderModel.find({
        sellerId: seller._id,
        bucket: DELIVERED,
        payment_mode: 1, // COD
        // createdAt: { $gte: currMonth }, // Filter for current month's orders
      }).populate('productId').lean()

      // Check for orders already included in any remittance
      const remittedOrderIds = new Set(
        (await RemittanceModel.find({ sellerId: seller._id }).lean())
          .flatMap((remittance) => remittance.orders)
          .map((order) => order._id.toString())
      );

      const unremittedOrders = orders.filter((order) => !remittedOrderIds.has(order._id.toString()));

      const ordersGroupedByDate = unremittedOrders.reduce(
        (acc, order) => {
          const length = order?.orderStages?.length;
          const deliveryDate = order?.orderStages[length - 1]?.stageDateTime;
          const deliveryDateOnly = format(deliveryDate, 'yyyy-MM-dd');

          if (!acc[deliveryDateOnly]) {
            acc[deliveryDateOnly] = [];
          }
          acc[deliveryDateOnly].push(order);
          return acc;
        },
        {}
      );

      for (const [deliveryDateStr, ordersOnSameDate] of Object.entries(ordersGroupedByDate)) {
        const deliveryDate = parseISO(deliveryDateStr);

        // Calculate the date exactly 7 days after delivery
        const sevenDaysAfterDelivery = addDays(deliveryDate, 7);

        // Find the nearest upcoming Friday after the 7th day
        const remittanceDate = format(nextFriday(sevenDaysAfterDelivery), "yyyy-MM-dd");

        // Check if a remittance already exists for this seller and remittance date
        const existingRemittance = await RemittanceModel.findOne({
          sellerId: seller._id,
          remittanceDate,
        }).lean();

        if (existingRemittance) {
          existingRemittance.orders.push(...ordersOnSameDate);
          existingRemittance.remittanceAmount += ordersOnSameDate.reduce(
            (sum, order) => sum + Number(order.amount2Collect),
            0
          );
          await RemittanceModel.updateOne({ _id: existingRemittance._id }, existingRemittance);
        } else {
          const remittanceId = generateRemittanceId(companyName, seller._id.toString(), remittanceDate);
          const remittanceAmount = ordersOnSameDate.reduce((sum, order) => sum + Number(order.amount2Collect), 0);
          const remittanceStatus = 'pending';
          const BankTransactionId = 'xxxxxxxxxxxxx'; // Static or replace as needed

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
      }
    }
  } catch (error) {
    console.error(error, '{error} in calculateRemittanceEveryDay');
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
          const bucketInfo = getDelhiveryBucketing(shipment_status);

          const orderStages = order?.orderStages || [];
          const lastStageActivity = orderStages[orderStages.length - 1]?.activity;

          if (
            bucketInfo.bucket !== -1 &&
            orderStages.length > 0 &&
            !lastStageActivity?.includes(shipment_status.Instructions)
          ) {
            order.bucket = bucketInfo.bucket;
            order.orderStages.push({
              stage: bucketInfo.bucket,
              action: bucketInfo.bucket == RTO ? `RTO ${shipment_status.Status}` : shipment_status.Status,
              stageDateTime: new Date(),
              activity: shipment_status.Instructions,
              location: shipment_status.StatusLocation,
            });

            try {
              await order.save();
            } catch (saveError) {
              console.log("Error occurred while saving order status:", saveError);
            }
          }

          if (bucketInfo.bucket === RTO && order?.rtoCharges === 0) {
            const rtoCharges = await shipmentAmtCalcToWalletDeduction(order.awb)
            await updateSellerWalletBalance(order.sellerId, rtoCharges?.rtoCharges, false, `${order.awb}, RTO charges`);
            if (rtoCharges.cod) await updateSellerWalletBalance(order.sellerId, rtoCharges.cod, true, `${order.awb}, RTO COD charges`)
            order.rtoCharges = rtoCharges?.rtoCharges;
            await order.save();
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

export const track_B2B_SHIPROCKET = async () => {
  try {
    const vendorNicknames = await EnvModel.findOne({ name: "SHIPROCKET_B2B" }).select("nickName");

    const orders = (await B2BOrderModel.find({
      bucket: { $in: ORDER_TO_TRACK },
      carrierName: { $regex: vendorNicknames?.nickName },
    }).select("bucket orderStages awb")).reverse();

    for (const order of orders) {
      try {
        let b2bShiprocketConfig = await getShiprocketB2BConfig();

        const apiUrl = `${config.SHIPROCKET_API_BASEURL}${APIs.B2B_SHIPMENT_TRACK}${order?.awb}`;
        const res = (await axios.get(apiUrl, { headers: { authorization: b2bShiprocketConfig.token } })).data;

        const history = res.status_history;
        const lastStatus = history[history.length - 1];

        const bucketInfo = getB2BShiprocketBucketing(lastStatus.status);
        const orderStages = order?.orderStages || [];
        const lastStageActivity = orderStages[orderStages.length - 1]?.activity;

        if (
          bucketInfo.bucket !== -1 &&
          orderStages.length > 0 &&
          !lastStageActivity?.includes(lastStatus.reason || lastStatus.status)
        ) {
          order.bucket = bucketInfo.bucket;
          order.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.bucket == RTO ? `RTO ${lastStatus.reason || lastStatus.status}` : (lastStatus.reason || lastStatus.status),
            stageDateTime: new Date(lastStatus.timestamp),
            activity: lastStatus.remarks,
            location: lastStatus.location,
          });

          try {
            await order.save();
          } catch (saveError) {
            console.log("Error occurred while saving order status:", saveError);
          }

          if (bucketInfo.bucket === RTO
            && ![RTO, RETURN_IN_TRANSIT, RETURN_ORDER_MANIFESTED, RETURN_OUT_FOR_PICKUP, RETURN_DELIVERED, RETURN_DELIVERED]
              .includes(orderWithOrderReferenceId?.bucket
              )) {
            const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb)
            await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.rtoCharges, false, `${orderWithOrderReferenceId.awb}, RTO charges`)
            if (rtoCharges.cod) await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges.cod, true, `${orderWithOrderReferenceId.awb}, RTO COD charges`)
          }
        }
      } catch (orderError) {
        console.log("Error processing order:", orderError);
      }
    }
  } catch (err) {
    console.log("Error fetching vendors or processing orders:", err);
  }
};


// Function used to fetch delhivery data and save it to a file
// async function fetchAndSaveData() {
//   try {
//     // Make the API request
// 
//     const delhiveryToken = await getDelhiveryTokenPoint5();

//     const apiUrl = `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_TRACK_ORDER}9145210460073`;
//     const response = await axios.get(apiUrl, { headers: { authorization: delhiveryToken } });

//     const data = response.data;

//     ensureDirectoryExistence('delhivery-0.5-tracking.json');
//     fs.writeFileSync("delhivery-0.5-tracking.json", JSON.stringify(data, null, 2), 'utf8');
//   } catch (error: any) {
//     console.error('Error fetching data:', error.message);
//   }
// }
// function ensureDirectoryExistence(filePath) {
//   const dirname = path.dirname(filePath);
//   if (!fs.existsSync(dirname)) {
//     fs.mkdirSync(dirname, { recursive: true });
//   }
// }

const autoCancelShipmetWhosePickupNotScheduled = async () => {
  try {
    const allOrders = await B2COrderModel.find({
      // sellerId: '663379872fc3a04d7cc1e7a1',
      bucket: 1,
      "orderStages.stage": { $ne: SHIPROCKET_MANIFEST_ORDER_STATUS }
    });

    // Calculate current timestamp
    const currentDate = new Date();
    
    // Filter orders that are older than 7 days
    const ordersToCancel = allOrders.filter(order => {
      const orderCreationDate = new Date(order.createdAt);
      const daysSinceCreation = Math.floor((currentDate - orderCreationDate) / (1000 * 60 * 60 * 24));
      return daysSinceCreation >= 7;
    });

    if (ordersToCancel.length > 0) {
      console.log(`Found ${ordersToCancel.length} orders to auto-cancel out of ${allOrders.length} total orders`);
      await cancelOrderShipment(ordersToCancel);
      console.log(`Successfully processed ${ordersToCancel.length} orders for auto-cancellation`);
    }

  } catch (error) {
    console.error("Error: [autoCancelShipmetWhosePickupNotScheduled]", error);
  }
}

export default async function runCron() {
  console.log("Running cron scheduler");

  const expression4every2Minutes = "*/2 * * * *";
  const expression4every30Minutes = "*/30 * * * *";
  const expression4every5Minutes = "*/5 * * * *";
  const expression4every59Minutes = "59 * * * *";
  const expression4every9_59Hr = "59 9 * * *";
  const expression4everyFriday = "0 0 * * 5";
  const expression4every12Hrs = "0 0,12 * * *";

  if (cron.validate(expression4every2Minutes)) {
    cron.schedule(expression4every30Minutes, track_delivery);  // Track order status every 30 minutes
    cron.schedule(expression4every30Minutes, await trackOrder_Shiprocket);  // Track order status every 30 minutes
    cron.schedule(expression4every30Minutes, track_B2B_SHIPROCKET);  // Track order status every 30 minutes
    cron.schedule(expression4every2Minutes, trackOrder_Smartship);
    cron.schedule(expression4every30Minutes, REFRESH_ZOHO_TOKEN);
    cron.schedule(expression4every2Minutes, scheduleShipmentCheck);
    cron.schedule(expression4every12Hrs, walletDeductionForBilledOrderOnEvery7Days);
    cron.schedule(expression4every12Hrs, autoCancelShipmetWhosePickupNotScheduled);

    // Need to fix
    // cron.schedule(expression4every12Hrs, disputeOrderWalletDeductionWhenRejectByAdmin);

    cron.schedule(expression4every9_59Hr, calculateRemittanceEveryDay);
    cron.schedule(expression4every59Minutes, CONNECT_SHIPROCKET);
    cron.schedule(expression4every59Minutes, CONNECT_SHIPROCKET_B2B);
    cron.schedule(expression4every59Minutes, CONNECT_SMARTSHIP);
    cron.schedule(expression4every5Minutes, CANCEL_REQUESTED_ORDER_SMARTSHIP);
    cron.schedule(expression4every12Hrs, CONNECT_MARUTI);

    // Email Cron
    cron.schedule(expression4every12Hrs, updatePaymentAlertStatus);
    cron.schedule(expression4every12Hrs, syncInvoicePdfs);
    cron.schedule(expression4every12Hrs, emailInvoiceWithPaymnetLink);


    // SMARTR discontinued
    // cron.schedule(expression4every2Minutes, trackOrder_Smartr);
    // cron.schedule(expression4every9_59Hr, CONNECT_SMARTR);

    Logger.log("Cron jobs scheduled successfully");
  } else {
    Logger.log("Invalid cron expression");
  }
}

// const disputeOrderWalletDeductionWhenRejectByAdmin = async () => {
//   try {
//     const disputeOrders = await ClientBillingModal.find({
//       isDisputeRaised: true,
//     }).populate("disputeId");
//     if (disputeOrders.length > 0) {
//       for (const order of disputeOrders) {
//         if (!order.disputeId.accepted) {
//           await updateSellerWalletBalance(order.sellerId, order.fwExcessCharge, false, `AWB: ${order.awb}, Revised`)
//         }
//       }
//     }
//   } catch (error: any) {
//     console.log("Error disputeOrderWalletDeductionWhenRejectByAdmin:", error);
//   }
// }


const walletDeductionForBilledOrderOnEvery7Days = async () => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const billedOrders = await ClientBillingModal.find({
      billingDate: { $lt: sevenDaysAgo },
      disputeRaisedBySystem: true
    });

    if (billedOrders.length === 0) {
      return;
    }

    await Promise.all(
      billedOrders.map(async (order) => {
        const updates = [];

        // Handle FW Excess Charge
        if (order.fwExcessCharge > 0) {
          updates.push(
            updateSellerWalletBalance(
              order.sellerId,
              Number(order.fwExcessCharge),
              false,
              `AWB: ${order.awb}, FW Excess Charge`
            )
          );
        }

        if (order.rtoExcessCharge > 0) {
          updates.push(
            updateSellerWalletBalance(
              order.sellerId,
              Number(order.rtoExcessCharge),
              false,
              `AWB: ${order.awb}, RTO Excess Charge`
            )
          );

          if (order.isRTOApplicable) {
            const paymentTransactions = await PaymentTransactionModal.find({
              desc: {
                $in: [
                  `${order.awb}, RTO-charges`,
                  `${order.awb}, RTO-COD-charges`,
                  `${order.awb}, RTO charges`,
                ],
              },
            });

            const isRtoChargeDeducted = paymentTransactions.some((pt) =>
              pt.desc.includes("RTO-charges") || pt.desc.includes("RTO charges")
            );
            const isRtoCODRefund = paymentTransactions.some((pt) =>
              pt.desc.includes("RTO-COD-charges") || pt.desc.includes("COD Refund")
            );

            if (!isRtoChargeDeducted) {
              updates.push(
                updateSellerWalletBalance(
                  order.sellerId,
                  Number(order.rtoCharge),
                  false,
                  `AWB: ${order.awb}, RTO-charges`
                )
              );
            }

            if (!isRtoCODRefund) {
              updates.push(
                updateSellerWalletBalance(
                  order.sellerId,
                  Number(order.codValue),
                  true,
                  `AWB: ${order.awb}, COD-Refund`
                )
              );
            }
          }
        }

        // if (order.zoneChangeCharge > 0) {
        //   updates.push(
        //     updateSellerWalletBalance(
        //       order.sellerId,
        //       Number(order.zoneChangeCharge),
        //       false,
        //       `AWB: ${order.awb}, Zone Change Charge ${order.orderZone} --> ${order.newZone}`
        //     )
        //   );
        // }

        order.paymentStatus = paymentStatusInfo.PAID;
        order.disputeRaisedBySystem = false;
        updates.push(order.save());

        await Promise.all(updates);
      })
    );
  } catch (error) {
    console.error("Error in walletDeductionForBilledOrderOnEvery7Days:", error);
  }
};

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
          (bucketInfo.bucket === DELIVERED || !(orderWithOrderReferenceId.orderStages[orderWithOrderReferenceId.orderStages.length - 1].activity?.includes(response.data.tracking_data?.shipment_track_activities?.[0]?.activity)))
        ) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.bucket == RTO ? `RTO ${bucketInfo.description}` : bucketInfo.description,
            activity: response.data.tracking_data?.shipment_track_activities?.[0]?.activity,
            location: response.data.tracking_data?.shipment_track_activities?.[0]?.location,
            stageDateTime: formatISO(parse(response?.data?.tracking_data?.shipment_track_activities?.[0]?.date, 'yyyy-MM-dd HH:mm:ss', new Date())) ?? new Date(),
          });
          try {
            await orderWithOrderReferenceId.save();
          } catch (error) {
            console.log("Error occurred while saving order status:", error);
          }
        }

        if (bucketInfo.bucket === RTO && orderWithOrderReferenceId.rtoCharges === 0) {
          const rtoCharges = await shipmentAmtCalcToWalletDeduction(orderWithOrderReferenceId.awb);
          await updateSellerWalletBalance(orderWithOrderReferenceId.sellerId, rtoCharges?.rtoCharges, false, `${orderWithOrderReferenceId.awb}, RTO charges`);
          orderWithOrderReferenceId.rtoCharges = rtoCharges?.rtoCharges;
          await orderWithOrderReferenceId.save();
        }

        trackedOrders.add(orderWithOrderReferenceId.awb);
      }
    } catch (err: any) {
      console.log(err, "SHIPROCKET ERROR TRACKING ORDER");
    }
  }
};

export const scheduleShipmentCheck = async () => {
  try {
    const shiprocketB2BVNickName = await EnvModel.findOne({ name: "SHIPROCKET_B2B" }).select("nickName");
    const withoutAwbOrders = await B2BOrderModel.find({
      awb: { $in: [null, ""] },
      carrierName: { $regex: shiprocketB2BVNickName?.nickName }
    });

    for (const order of withoutAwbOrders) {
      const shiprocketB2BConfig = await getShiprocketB2BConfig();
      const apiUrl = `${config.SHIPROCKET_B2B_API_BASEURL}${APIs.B2B_GET_SHIPMENT}${order.orderShipmentId}`;
      if (!order.orderShipmentId || order.orderShipmentId === undefined) continue;

      const response = await axios.get(apiUrl, {
        headers: {
          Authorization: shiprocketB2BConfig.token,
          "Content-Type": "application/json",
        },
      });

      const shipmentData = response.data;
      order.awb = shipmentData.waybill_no;
      order.label_url = shipmentData.label_url;
      await order.save();

      const pdfUrl = shipmentData.label_url
      const wordsToRemove = ['PICKRR', 'TECHNOLOGIES'];
      const replacementText = '';
      const outputFilePath = path.join(__dirname, '../public/shipment_labels', `${order.orderShipmentId}.pdf`);

      if (order.carrierName?.toLowerCase().includes("gati")) await modifyPdf(pdfUrl, wordsToRemove, replacementText, outputFilePath, order.sellerId);
    }

  } catch (error) {
    console.error("Error fetching shipment details: B2B SHIPROCKET", error);
  }
}


export const updatePaymentAlertStatus = async () => {
  try {
    const invoices = await InvoiceModel.find({ status: 'pending', isPrepaidInvoice: false })
    for (let i = 0; i < invoices.length; i++) {
      const seller = await SellerModel.findById(invoices[i].sellerId)
      seller.showPaymentAlert === true;
      await seller?.save()
    }
  } catch (err) {
    console.log("Error in updatePaymentAlertStatus", err)
  }
}



function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// async function zohoUser() {
//   try {
//     const sellers: any[] = [
//       { email: "parichha.surya@gmail.com", zoho_contect_id: "852186000000015775" },
//       { email: "woof@caninecraving.com", zoho_contect_id: "852186000000016155" },
//       { email: "logistics@sportsjam.in", zoho_contect_id: "852186000000016271" },
//       { email: "balaji.m@readyassist.in", zoho_contect_id: "852186000000016560" },
//       { email: "innovationn09@gmail.com", zoho_contect_id: "852186000000020243" },
//       { email: "nuttysdenpetworld@gmail.com", zoho_contect_id: "852186000000087163" },
//       { email: "mansi@tanntrim.com", zoho_contect_id: "852186000000090069" },
//       { email: "manishjain644@gmail.com", zoho_contect_id: "852186000000170001" },
//       { email: "nripendra@ayurmeans.com", zoho_contect_id: "852186000000305083" },
//       { email: "admin@noahsports.in", zoho_contect_id: "852186000001069003" },
//       { email: "info@dadudadiskitchen.com", zoho_contect_id: "852186000001173327" },
//       { email: "shruti@thestruttstore.com", zoho_contect_id: "852186000001418017" },
//       { email: "info@clayandhearth.com", zoho_contect_id: "852186000001429005" },
//       { email: "info@pepperwicks.com", zoho_contect_id: "852186000001454003" },
//       { email: "shanualidelhi0786@gmail.com", zoho_contect_id: "852186000001706043" },
//       { email: "sushilbardia@live.com", zoho_contect_id: "852186000001759023" },
//       { email: "delivery@houseofdeepthiltd.com", zoho_contect_id: "852186000001759043" },
//       { email: "balaji@scorpionventures.com", zoho_contect_id: "852186000001790265" },
//       { email: "deepender@swizzle.in", zoho_contect_id: "852186000002187163" },
//       { email: "ravi8877@gmail.com", zoho_contect_id: "852186000002187163" },
//       { email: "nishant_singh@lorrigo.com", zoho_contect_id: "852186000002187163" },
//       { email: "fashion.freaks030@gmail.com", zoho_contect_id: "852186000002187163" },
//       { email: "tr5531803@gmail.com", zoho_contect_id: "852186000002187163" },
//       { email: "sakshi.mahajan1422@gmail.com", zoho_contect_id: "852186000002187163" },
//       { email: "nishant10194@gmail.com", zoho_contect_id: "852186000002187163" },
//     ]
//     const sellerEmails = sellers.map((seller) => seller.email);

//     const usersToUpdateZoho = await SellerModel.find({
//       email: { $nin: sellerEmails },
//     });

//     if (usersToUpdateZoho.length === 0) {
//       console.log("No users need to be updated in Zoho.");
//       return;
//     }

//     const token = await generateAccessToken(); // Ensure this function exists and works correctly

//     for (const user of usersToUpdateZoho) {
//       const data = {
//         contact_name: user.name,
//         email: user.email,
//       };

//       console.log(data, "data")

//       try {

//         const response = await axios.post(
//           `https://www.zohoapis.in/books/v3/contacts?organization_id=60014023368`,
//           JSON.stringify(data),
//           {
//             headers: {
//               "Content-Type": "application/json",
//               Authorization: `Zoho-oauthtoken ${token}`,
//             },
//           }
//         );

//         console.log(response?.data?.contact, "response?.data?.contact")
//         if (response?.data?.contact) {
//           user.zoho_contact_id = response.data.contact.contact_id;
//           await user.save();
//           console.log(`Updated Zoho contact ID for user: ${user.email}`);
//         } else {
//           console.log(`Failed to update Zoho contact for user: ${user.email}`);
//         }

//         await delay(10000); // 10-second delay

//       } catch (err) {
//         console.error(`Error updating user ${user.email}:`, err);
//       }
//     }
//   } catch (error) {
//     console.error("Error while updating Zoho users:", error);
//   }
// }

async function syncInvoicePdfs(): Promise<void> {
  try {
    // Get all invoices that need PDF updates
    const invoices = await InvoiceModel.find({
      status: { $ne: "paid" }
    });

    if (invoices.length === 0) {
      console.log('No invoices need PDF updates');
      return;
    }

    const accessToken = await generateAccessToken();

    await processZohoBatch(invoices, accessToken);

    console.log('Completed PDF sync for all invoices');
  } catch (error) {
    console.error('Error in syncInvoicePdfs:', error);
  }
}

async function fetchInvoicePdf(invoiceId: string, accessToken: string): Promise<string> {
  try {
    const response = await axios.get(
      `https://www.zohoapis.in/books/v3/invoices/${invoiceId}?organization_id=60014023368&accept=pdf`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        responseType: "arraybuffer",
      }
    );

    return Buffer.from(response.data, "binary").toString("base64");
  } catch (error) {
    console.error(`Error fetching PDF for invoice ${invoiceId}:`, error);
    throw error;
  }
}

async function processZohoBatch(invoices: any[], accessToken: string): Promise<void> {
  const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in milliseconds

  for (let i = 0; i < invoices.length; i += 3) {
    const batch = invoices.slice(i, i + 3);

    try {
      for (const invoice of batch) {
        try {
          const pdfBase64 = await fetchInvoicePdf(invoice.invoice_id, accessToken);

          await InvoiceModel.findOneAndUpdate(
            { invoice_id: invoice.invoice_id },
            { $set: { pdf: pdfBase64 } }
          );

          console.log(`Successfully updated PDF for invoice ${invoice.invoice_id}`);

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Failed to process invoice ${invoice.invoice_id}:`, error);
        }
      }

      // Add a delay between batches
      if (i + 3 < invoices.length) {
        await new Promise(resolve => setTimeout(resolve, FIVE_MINUTES)); // 2 second delay between batches
      }
    } catch (error) {
      console.error(`Error processing batch starting at index ${i}:`, error);
    }
  }
}

// Email
async function emailInvoiceWithPaymnetLink(): Promise<void> {
  try {
    const invoices = await InvoiceModel.find({ status: { $ne: "paid" } }).populate('sellerId');

    if (!invoices || invoices.length === 0) {
      console.log('No invoices need email reminders');
      return;
    }

    const emailTemplatePath = path.join(__dirname, '../email-template/invoice-template.html');
    const emailTemplate = fs.readFileSync(emailTemplatePath, 'utf8');

    for (const invoice of invoices) {
      const seller: any = invoice.sellerId;
      if (!seller || !seller.email) {
        console.warn(`No email found for seller of invoice ID: ${invoice.invoice_id}`);
        continue;
      }

      // Fill dynamic placeholders in the template
      const filledEmail = emailTemplate
        .replaceAll('{{invoiceId}}', invoice.invoice_number || '')
        .replaceAll('{{userName}}', seller.name || 'Seller')
        .replaceAll('{{invoiceAmt}}', formatCurrencyForIndia(invoice.dueAmount) || '0')
        .replaceAll('{{invoiceDate}}', invoice.date || 'N/A');

      await emailService.sendEmailWithCSV(
        seller.email,
        `Invoice Payment Reminder: ${invoice.invoice_number}`,
        filledEmail,
        await generateListInoviceAwbs(invoice?.invoicedAwbs || [], invoice.invoice_number),
        "Invoice AWBs",
        Buffer.from(invoice.pdf, 'base64'),
        "Invoice"
      );
    }
  } catch (error) {
    console.error('Error in emailInvoiceWithPaymnetLink:', error);
  }
}

async function emailSellerMonthlyWalletSummary(): Promise<void> {
  try {
    const walletSummaries = await PaymentTransactionModal.aggregate([
      // Step 1: Filter transactions for the last 30 days
      {
        $match: {
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 30)), // Last 30 days
          },
        },
      },
      // Step 2: Join with the Seller collection to get seller details
      {
        $lookup: {
          from: "sellers", // Collection name for SellerModel
          localField: "sellerId", // Field in transactions to join
          foreignField: "_id", // Field in SellerModel to join
          as: "sellerInfo", // Output field with seller data
        },
      },
      // Step 3: Filter only prepaid sellers
      {
        $match: {
          "sellerInfo.config.isPrepaid": true,
        },
      },
      // Step 4: Unwind the sellerInfo array to access individual fields
      {
        $unwind: "$sellerInfo",
      },
      // Step 5: Group transactions by sellerId and calculate aggregations
      {
        $group: {
          _id: "$sellerId", // Group by sellerId
          totalAdded: {
            $sum: {
              $cond: [{ $eq: ["$code", "PAYMENT_SUCCESS"] }, { $toDouble: "$amount" }, 0],
            },
          },
          totalSpent: {
            $sum: {
              $cond: [{ $eq: ["$code", "DEBIT"] }, { $toDouble: "$amount" }, 0],
            },
          },
          lastWalletBalance: { $last: "$lastWalletBalance" }, // Most recent wallet balance
          sellerName: { $first: "$sellerInfo.name" }, // Seller name from sellerInfo
          sellerEmail: { $first: "$sellerInfo.email" }, // Seller email from sellerInfo
        },
      },
      // Step 6: Project the final fields to include in the result
      {
        $project: {
          _id: 1, // Seller ID
          sellerName: 1,
          sellerEmail: 1,
          totalAdded: 1,
          totalSpent: 1,
          lastWalletBalance: 1,
        },
      },
    ]);

    const emailTemplatePath = path.join(__dirname, '../email-template/monthly-wallet-txn.html');
    const emailTemplate = fs.readFileSync(emailTemplatePath, 'utf8');

    // Fill dynamic placeholders in the template
    const filledEmail = emailTemplate
      .replaceAll('{{invoiceId}}', invoice.invoice_number || '')
      .replaceAll('{{userName}}', seller.name || 'Seller')
      .replaceAll('{{invoiceAmt}}', formatCurrencyForIndia(invoice.dueAmount) || '0')
      .replaceAll('{{invoiceDate}}', invoice.date || 'N/A');

    await emailService.sendEmail(
      seller.email,
      "Monthly Wallet Summary",
      filledEmail,
    );
  } catch (error) {
    console.error('Error in emailInvoiceWithPaymnetLink:', error);
  }
}