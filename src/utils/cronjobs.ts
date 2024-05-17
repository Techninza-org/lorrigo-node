import axios from "axios";
import { B2COrderModel } from "../models/order.model";
import config from "./config";
import APIs from "./constants/third_party_apis";
import { getShiprocketBucketing, getShiprocketToken, getSmartShipToken, getSmartshipBucketing } from "./helpers";
import * as cron from "node-cron";
import EnvModel from "../models/env.model";
import https from "node:https";
import Logger from "./logger";
import { RequiredTrackResponse, TrackResponse } from "../types/b2c";
import { generateRemittanceId, getFridayDate } from ".";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { CANCELED, CANCELLATION_REQUESTED_ORDER_STATUS, CANCELLED_ORDER_DESCRIPTION, DELIVERED, ORDER_TO_TRACK } from "./lorrigo-bucketing-info";

/**
 * Update order with statusCode (2) to cancelled order(3)
 * prints Error if occurred during this process
 * @returns Promise(void)
 */
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
    console.log("Shiprocket token: ", token);
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
    const response = await axios.post("https://uat.smartr.in/api/v1/get-token/", requestBody, {
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

/**
 * function to run CronJobs currrently one cron is scheduled to update the status of order which are cancelled to "Already Cancelled".
 * @emits CANCEL_REQUESTED_ORDER
 * @returns void
 */

export const trackOrder_Smartship = async () => {
  const orders = await B2COrderModel.find({ bucket: { $in: ORDER_TO_TRACK } });

  for (const orderWithOrderReferenceId of orders) {
    const orderCarrierName = orderWithOrderReferenceId?.carrierName?.split(" ").pop();

    const vendorNickname = await EnvModel.findOne({ name: "SMARTSHIP" }).select("nickName")
    const isSmartship = vendorNickname && (orderCarrierName === vendorNickname.nickName);

    if (!isSmartship) {
      continue;
    }

    const smartshipToken = await getSmartShipToken();
    if (!smartshipToken) {
      Logger.warn("FAILED TO RUN JOB, SMART SHIP TOKEN NOT FOUND");
      return;
    }

    const shipmentAPIConfig = { headers: { Authorization: smartshipToken } };

    try {
      const apiUrl = `${config.SMART_SHIP_API_BASEURL}${APIs.TRACK_SHIPMENT}=${orderWithOrderReferenceId._id + "_" + orderWithOrderReferenceId.order_reference_id}`;
      const response = await axios.get(apiUrl, shipmentAPIConfig);

      const responseJSON: TrackResponse = response.data;
      if (responseJSON.message === "success") {
        const keys: string[] = Object.keys(responseJSON.data.scans);
        const requiredResponse: RequiredTrackResponse = responseJSON.data.scans[keys[0]][0];

        const bucketInfo = getSmartshipBucketing(Number(requiredResponse?.status_code) ?? -1);


        if ((bucketInfo.bucket !== -1) && (orderWithOrderReferenceId.bucket !== bucketInfo.bucket)) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.description,
            stageDateTime: new Date(),
          });
          try {
            await orderWithOrderReferenceId.save();
          } catch (error) {
            Logger.err("Error occurred while saving order status:", error);
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

  const orders = await B2COrderModel.find({
    bucket: { $in: ORDER_TO_TRACK },
  });

  for (const orderWithOrderReferenceId of orders) {
    try {

      const orderCarrierName = orderWithOrderReferenceId?.carrierName?.split(" ").pop();

      const vendorNickname = await EnvModel.findOne({ name: "SHIPROCKET" }).select("nickName")
      const isShiprocket = vendorNickname && (orderCarrierName === vendorNickname.nickName);

      if (!isShiprocket) {
        continue;
      }

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


        if ((bucketInfo.bucket !== -1) && (orderWithOrderReferenceId.bucket !== bucketInfo.bucket)) {
          orderWithOrderReferenceId.bucket = bucketInfo.bucket;
          orderWithOrderReferenceId.orderStages.push({
            stage: bucketInfo.bucket,
            action: bucketInfo.description,
            stageDateTime: new Date(),
          });
          try {
            await orderWithOrderReferenceId.save();
          } catch (error) {
            console.log("Error occurred while saving order status:", error);
          }
        }
      }

    } catch (err) {
      // Need to fix shiprocket throwing error "Too many attempt" 
      // console.log(err, "SR_error");

      Logger.err(err);
    }
  }
};

export const calculateRemittance = async () => {
  try {
    const companyName = 'L';
    const currentDate = new Date();
    const fridayDate = getFridayDate(currentDate); // Function to get the Friday date of the current week
    const sellerIds = await SellerModel.find({}).select("_id");

    for (const sellerId of sellerIds) {
      const existingRemittance = await RemittanceModel.findOne({ sellerId: sellerId, remittanceDate: fridayDate });
      if (existingRemittance) {
        console.log(`Remittance already exists for seller: ${sellerId} on ${fridayDate}`);
        continue; // Skip adding remittance for this seller on this Friday
      }

      const remittanceId = generateRemittanceId(companyName, sellerId._id.toString(), fridayDate);
      const remittanceDate = fridayDate;
      let remittanceAmount = 0;
      const remittanceStatus = 'pending';
      const orders = await B2COrderModel.find({ sellerId: sellerId, bucket: DELIVERED, payment_mode: 1 }).populate("productId");
      const BankTransactionId = '1234567890';
      if (orders.length > 0) {
        orders.forEach(order => {
          // @ts-ignore
          remittanceAmount += Number(order.amount2Collect);
        });
        const remittance = new RemittanceModel({
          sellerId: sellerId,
          remittanceId: remittanceId,
          remittanceDate: remittanceDate,
          remittanceAmount: remittanceAmount,
          remittanceStatus: remittanceStatus,
          orders: orders,
          BankTransactionId: BankTransactionId
        });
        await remittance.save();
      }
    }
  } catch (error) {
    console.log(error, "{error} in calculateRemittance");
  }
}


export default async function runCron() {
  console.log("to run cron")
  const expression4every2Minutes = "*/2 * * * *";
  if (cron.validate(expression4every2Minutes)) {
    cron.schedule(expression4every2Minutes, trackOrder_Smartship);
    cron.schedule(expression4every2Minutes, trackOrder_Shiprocket);

    const expression4every5Minute = "5 * * * *";
    const expression4every59Minute = "59 * * * *";
    const expression4every9_59Hr = "59 9 * * * ";
    const expression4everyFriday = "0 0 * * 5";

    cron.schedule(expression4everyFriday, calculateRemittance);
    cron.schedule(expression4every59Minute, CONNECT_SHIPROCKET);
    cron.schedule(expression4every59Minute, CONNECT_SMARTSHIP);
    cron.schedule(expression4every5Minute, CANCEL_REQUESTED_ORDER_SMARTSHIP);
    cron.schedule(expression4every9_59Hr, CONNECT_SMARTR);

    Logger.log("cron scheduled");
  } else {
    Logger.log("Invalid cron expression");
  }
}