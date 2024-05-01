import axios from "axios";
import config from "./config";
import EnvModel from "../models/env.model";
import type { NextFunction, Request, Response } from "express";
import CourierModel from "../models/courier.model";
import PincodeModel from "../models/pincode.model";
import SellerModel from "../models/seller.model";
import { ExtendedRequest } from "./middleware";
import APIs from "./constants/third_party_apis";
import Logger from "./logger";
import https from "node:https";
import { isValidObjectId } from "mongoose";
import CustomPricingModel from "../models/custom_pricing.model";
import envConfig from "./config";
import { Types } from "mongoose";
import { CANCELED, DELIVERED, IN_TRANSIT, LOST_DAMAGED, NDR, RTO } from "./lorrigo-bucketing-info";

export const validateEmail = (email: string): boolean => {
  return /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)*[a-zA-Z]{2,}))$/.test(
    email
  );
};

export const validatePhone = (phone: number): boolean => {
  return phone > 999999999;
};

export const validateSmartShipServicablity = async (
  orderType: 0 | 1,
  hub_id: number,
  destinationPinode: number,
  orderWeight: number,
  prefferredCarrier: number[]
): Promise<boolean> => {
  const requestBody: any = {
    order_info: {
      hub_ids: [hub_id],
      destination_pincode: destinationPinode,
      orderWeight: orderWeight,
      preferred_carriers: [...prefferredCarrier],
    },
    request_info: { extra_info: true, cost_info: false },
  };
  if (orderType) {
    // 1/ true for forward 0 for reverse
    requestBody.order_info.destination_pincode = destinationPinode;
  } else {
    requestBody.source_pincode = destinationPinode;
  }
  const smartshipToken = await getSmartShipToken();

  const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };
  try {
    const response = await axios.post(
      config.SMART_SHIP_API_BASEURL + APIs.HUB_SERVICEABILITY,
      requestBody,
      smartshipAPIconfig
    );
    const responseData = response.data;
    return responseData.data.serviceability_status;
  } catch (err) {
    return false;
  }

  return false;
};

export const addVendors = async (req: Request, res: Response, next: NextFunction) => {
  const vendor = new CourierModel(req.body);
  let savedVendor;
  try {
    savedVendor = await vendor.save();
  } catch (err) {
    // console.log(err);
    return next(err);
  }
  return res.status(200).send({
    valid: true,
    vendor: savedVendor,
  });
};

export const updateVendor4Seller = async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  if (!isValidPayload(body, ["vendorId", "sellerId"])) {
    return res.status(200).send({ valid: false, message: "Invalid payload." });
  }
  const { vendorId, sellerId } = body;
  if (!isValidObjectId(vendorId) || !isValidObjectId(sellerId)) {
    return res.status(200).send({ valid: false, message: "Invalid vendorId or sellerId." });
  }
  try {
    const vendor = await CourierModel.findById(vendorId);
    if (!vendor) return res.status(200).send({ valid: false, message: "Vendor not found" });
    delete body?.vendorId;
    delete body?.sellerId;
    const previouslySavedPricing = await CustomPricingModel.findOne({ sellerId, vendorId }).lean();
    let savedPricing;
    if (previouslySavedPricing) {
      //update it
      savedPricing = await CustomPricingModel.findByIdAndUpdate(previouslySavedPricing._id, { ...body }, { new: true });
      return res.status(200).send({ valid: true, message: "vendor priced updated for user", savedPricing });
    } else {
      // create it
      const toAdd = {
        vendorId: vendorId,
        sellerId: sellerId,
        withinCity: vendor.withinCity,
        withinZone: vendor.withinZone,
        withinMetro: vendor.withinMetro,
        withinRoi: vendor.withinRoi,
        northEast: vendor.northEast,
        ...body,
      };
      savedPricing = new CustomPricingModel(toAdd);
      savedPricing = await savedPricing.save();
      return res.status(200).send({ valid: true, message: "vendor priced updated for user", savedPricing });
    }
    return res.status(200).send({ valid: false, message: "Incomplee " });
  } catch (err) {
    return next(err);
  }
  return res.status(200).send({ valid: false, message: "Not implemented yet" });
};

export const getSellers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellers = await SellerModel.find({}, { password: 0, __v: 0 });
    res.status(200).send({
      valid: true,
      sellers: sellers,
    });
  } catch (err) {
    return next(err);
  }
};

export const isValidPayload = (body: any, field: string[]): boolean => {
  if (Object.keys(body).length === 0) return false;
  for (let i = 0; i < field.length; i++) {
    if (!Object.keys(body).includes(field[i])) {
      Logger.log(field[i] + " is not a valid");
      return false;
    }
  }
  return true;
};
// TODO: implementation of COD IS REMAINING
export const ratecalculatorController = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const body = req.body;
  const seller = req.seller;
  const users_vendors = seller?.vendors || [];
  console.log(users_vendors)
  if (
    !isValidPayload(body, [
      "pickupPincode",
      "deliveryPincode",
      "weight",
      "weightUnit",
      "boxLength",
      "boxWidth",
      "boxHeight",
      "sizeUnit",
      "paymentType",
      // "isFragileGoods",
    ])
  ) {
    return res.status(200).send({
      valid: false,
      message: "inalid payload",
    });
  }

  try {

    let weight = body.weight;

    const numPaymentType = Number(body.paymentType);
    if (!(numPaymentType === 0 || numPaymentType === 1)) throw new Error("Invalid paymentType");
    if (body.paymentType === 1) {
      if (!body.collectableAmount) throw new Error("collectable amount is required.");
    }
    if (body.weightUnit === "g") {
      weight = (1 / 1000) * weight;
    }
    let volumetricWeight = null;
    if (body.sizeUnit === "cm") {
      const volume = body.boxLength * body.boxWidth * body.boxHeight;
      volumetricWeight = Math.round(volume / 5000);
    } else if (body.sizeUnit === "m") {
      volumetricWeight = Math.round((body.boxLength * body.boxWidth * body.boxHeight) / 5);
    } else {
      throw new Error("unhandled size unit");
    }

    const pickupDetails = await getPincodeDetails(Number(body.pickupPincode));
    const deliveryDetails = await getPincodeDetails(Number(body.deliveryPincode));

    if (!pickupDetails || !deliveryDetails) throw new Error("invalid pickup or delivery pincode");


    const data2send: {
      name: string;
      minWeight: number;
      charge: number;
      type: string;
      expectedPickup: string;
      carrierID: number;
      order_zone: string;
      nickName?: string;

    }[] = [];

    // Convert vendor IDs to ObjectId format
    // @ts-ignore
    const vendorIds = users_vendors.map(convertToObjectId).filter(id => id !== null);

    // Check if any IDs failed to convert
    if (vendorIds.length !== users_vendors.length) {
      console.error('Some vendor IDs could not be converted.');
    }

    const vendors = await CourierModel.find({
      _id: { $in: vendorIds }
    });


    const loopLength = vendors.length;


    for (let i = 0; i < loopLength; i++) {
      console.log(weight, "wright")
      let orderWeight = volumetricWeight > Number(weight) ? volumetricWeight : Number(weight);
      const cv = vendors[i];
      console.log("cv", cv)

      let order_zone = "";
      let increment_price = null;
      const userSpecificUpdatedVendorDetails = await CustomPricingModel.find({
        vendorId: cv._id,
        sellerId: seller._id,
      });
      if (userSpecificUpdatedVendorDetails.length === 1) {
        cv.withinCity = userSpecificUpdatedVendorDetails[0].withinCity;
        cv.withinZone = userSpecificUpdatedVendorDetails[0].withinZone;
        cv.withinMetro = userSpecificUpdatedVendorDetails[0].withinMetro;
        cv.northEast = userSpecificUpdatedVendorDetails[0].northEast;
        cv.withinRoi = userSpecificUpdatedVendorDetails[0].withinRoi;
      }
      if (pickupDetails.District === deliveryDetails.District) {
        increment_price = cv.withinCity;
        order_zone = "Zone A";
      } else if (pickupDetails.StateName === deliveryDetails.StateName) {
        // same state
        increment_price = cv.withinZone;
        order_zone = "Zone B";
      } else if (
        MetroCitys.find((city) => city === pickupDetails?.District) &&
        MetroCitys.find((city) => city === deliveryDetails?.District)
      ) {
        // metro citys
        increment_price = cv.withinMetro;
        order_zone = "Zone C";
      } else if (
        NorthEastStates.find((state) => state === pickupDetails?.StateName) &&
        NorthEastStates.find((state) => state === deliveryDetails?.StateName)
      ) {
        // north east
        increment_price = cv.northEast;
        order_zone = "Zone E";
      } else {
        increment_price = cv.withinRoi;
        order_zone = "Zone D";
      }
      if (!increment_price) {
        return [{ message: "invalid incrementPrice" }];
      }
      const parterPickupTime = cv.pickupTime;
      const partnerPickupHour = Number(parterPickupTime.split(":")[0]);
      const partnerPickupMinute = Number(parterPickupTime.split(":")[1]);
      const partnerPickupSecond = Number(parterPickupTime.split(":")[2]);
      const pickupTime = new Date(new Date().setHours(partnerPickupHour, partnerPickupMinute, partnerPickupSecond, 0));

      const currentTime = new Date();
      let expectedPickup: string;
      if (pickupTime < currentTime) {
        expectedPickup = "Tomorrow";
      } else {
        expectedPickup = "Today";
      }

      const minWeight = cv.weightSlab;
      // TODO apply cod
      //@ts-ignore
      let totalCharge = 0;
      totalCharge += increment_price.basePrice;
      orderWeight = orderWeight - cv.weightSlab;
      const codPrice = cv.codCharge?.hard;
      const codAfterPercent = (cv.codCharge?.percent / 100) * body.collectableAmount;
      let cod = 0;
      if (body.paymentType === 1) {
        cod = codPrice > codAfterPercent ? codPrice : codAfterPercent;
      }
      const weightIncrementRatio = Math.ceil(orderWeight / cv.incrementWeight);
      // console.log("weightIncrementRatio", weightIncrementRatio)
      totalCharge += increment_price.incrementPrice * weightIncrementRatio + cod;

      data2send.push({
        name: cv.name,
        minWeight,
        charge: totalCharge,
        type: cv.type,
        expectedPickup,
        carrierID: cv.carrierID,
        order_zone,
      });
    }

    return res.status(200).send({ valid: true, rates: data2send });
  } catch (err) {
    return next(err);
  }
};

const convertToObjectId = (id: string) => {
  try {
    return new Types.ObjectId(id);
  } catch (error) {
    console.error(`Invalid ObjectId: ${id}`);
    return null;
  }
};

export const rateCalculation = async (
  shiprocketOrderID: string,
  pickupPincode: any,
  deliveryPincode: any,
  weight: any,
  weightUnit: any,
  boxLength: any,
  boxWidth: any,
  boxHeight: any,
  sizeUnit: any,
  paymentType: 0 | 1,
  users_vendors: string[],
  seller_id: any,
  collectableAmount?: any,
  hubId?: number,
) => {
  const numPaymentType = Number(paymentType);
  if (!(numPaymentType === 0 || numPaymentType === 1)) throw new Error("Invalid paymentType");
  if (paymentType === 1) {
    if (!collectableAmount) throw new Error("collectable amount is required.");
  }
  if (weightUnit === "g") {
    weight = (1 / 1000) * weight;
  }
  let volumetricWeight = null;
  if (sizeUnit === "cm") {
    const volume = boxLength * boxWidth * boxHeight;
    volumetricWeight = Math.round(volume / 5000);
  } else if (sizeUnit === "m") {
    volumetricWeight = Math.round((boxLength * boxWidth * boxHeight) / 5);
  } else {
    throw new Error("unhandled size unit");
  }

  const pickupDetails = await getPincodeDetails(Number(pickupPincode));
  const deliveryDetails = await getPincodeDetails(Number(deliveryPincode));

  if (!pickupDetails || !deliveryDetails) throw new Error("invalid pickup or delivery pincode");

  // Convert vendor IDs to ObjectId format
  const vendorIds = users_vendors.map(convertToObjectId).filter(id => id !== null);

  // Check if any IDs failed to convert
  if (vendorIds.length !== users_vendors.length) {
    console.error('Some vendor IDs could not be converted.');
  }

  const vendors = await CourierModel.find({
    _id: { $in: vendorIds }
  });

  let commonCouriers: any[] = [];

  try {
    const token = await getShiprocketToken();
    if (!token) return [{ message: "Invalid Shiprocket token" }];

    const url = envConfig.SHIPROCKET_API_BASEURL + APIs.SHIPROCKET_ORDER_COURIER + `/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=0&order_id=${shiprocketOrderID}`;

    const config = {
      headers: {
        Authorization: token,
      },
    };

    const response = await axios.get(url, config);
    const courierCompanies = response?.data?.data?.available_courier_companies;


    const shiprocketNiceName = await EnvModel.findOne({ name: "SHIPROCKET" }).select("_id nickName");
    vendors.forEach((vendor: any) => {
      const courier = courierCompanies.find((company: { courier_company_id: number; }) => company.courier_company_id === vendor.carrierID);
      if (courier && shiprocketNiceName) {

        const shiprocketVendors = vendors.filter((vendor) => {
          return vendor?.vendor_channel_id?.toString() === shiprocketNiceName._id.toString();
        });

        if (shiprocketVendors.length > 0) {
          commonCouriers.push({
            ...vendor.toObject(),
            nickName: shiprocketNiceName.nickName
          });
        }
      }
    });
  } catch (error) {
    console.log("error", error);
  }


  try {
    const isSmartshipServicable = await validateSmartShipServicablity(
      1,
      hubId || 1,
      Number(deliveryPincode),
      weight,
      []
    );

    const smartShipNiceName = await EnvModel.findOne({ name: "SMARTSHIP" }).select("_id nickName");
    if (smartShipNiceName) {
      const smartShipVendors = vendors.filter((vendor) => {
        return vendor?.vendor_channel_id?.toString() === smartShipNiceName._id.toString();
      });
      if (isSmartshipServicable) {
        // Add nickname for each vendor in smartShipVendors array
        const smartShipVendorsWithNickname = smartShipVendors.map((vendor) => {
          return {
            ...vendor.toObject(), // Convert vendor to plain JavaScript object
            nickName: smartShipNiceName.nickName
          };
        });
        commonCouriers.push(...smartShipVendorsWithNickname);
      }
    }
  } catch (error) {
    console.log("error", error);
  }

  const data2send: {
    name: string;
    minWeight: number;
    charge: number;
    type: string;
    expectedPickup: string;
    carrierID: number;
    order_zone: string;
    nickName?: string;

  }[] = [];

  const loopLength = commonCouriers.length;


  for (let i = 0; i < loopLength; i++) {
    let orderWeight = volumetricWeight > Number(weight) ? volumetricWeight : Number(weight);
    const cv = commonCouriers[i];

    let order_zone = "";
    let increment_price = null;
    const userSpecificUpdatedVendorDetails = await CustomPricingModel.find({
      vendorId: cv._id,
      sellerId: seller_id,
    });
    if (userSpecificUpdatedVendorDetails.length === 1) {
      cv.withinCity = userSpecificUpdatedVendorDetails[0].withinCity;
      cv.withinZone = userSpecificUpdatedVendorDetails[0].withinZone;
      cv.withinMetro = userSpecificUpdatedVendorDetails[0].withinMetro;
      cv.northEast = userSpecificUpdatedVendorDetails[0].northEast;
      cv.withinRoi = userSpecificUpdatedVendorDetails[0].withinRoi;
    }
    if (pickupDetails.District === deliveryDetails.District) {
      increment_price = cv.withinCity;
      order_zone = "Zone A";
    } else if (pickupDetails.StateName === deliveryDetails.StateName) {
      // same state
      increment_price = cv.withinZone;
      order_zone = "Zone B";
    } else if (
      MetroCitys.find((city) => city === pickupDetails?.District) &&
      MetroCitys.find((city) => city === deliveryDetails?.District)
    ) {
      // metro citys
      increment_price = cv.withinMetro;
      order_zone = "Zone C";
    } else if (
      NorthEastStates.find((state) => state === pickupDetails?.StateName) &&
      NorthEastStates.find((state) => state === deliveryDetails?.StateName)
    ) {
      // north east
      increment_price = cv.northEast;
      order_zone = "Zone E";
    } else {
      increment_price = cv.withinRoi;
      order_zone = "Zone D";
    }
    if (!increment_price) {
      return [{ message: "invalid incrementPrice" }];
    }
    const parterPickupTime = cv.pickupTime;
    const partnerPickupHour = Number(parterPickupTime.split(":")[0]);
    const partnerPickupMinute = Number(parterPickupTime.split(":")[1]);
    const partnerPickupSecond = Number(parterPickupTime.split(":")[2]);
    const pickupTime = new Date(new Date().setHours(partnerPickupHour, partnerPickupMinute, partnerPickupSecond, 0));

    const currentTime = new Date();
    let expectedPickup: string;
    if (pickupTime < currentTime) {
      expectedPickup = "Tomorrow";
    } else {
      expectedPickup = "Today";
    }

    const minWeight = cv.weightSlab;
    // TODO apply cod
    //@ts-ignore
    let totalCharge = 0;
    totalCharge += increment_price.basePrice;
    orderWeight = orderWeight - cv.weightSlab;
    const codPrice = cv.codCharge?.hard;
    const codAfterPercent = (cv.codCharge?.percent / 100) * collectableAmount;
    let cod = 0;
    if (paymentType === 1) {
      cod = codPrice > codAfterPercent ? codPrice : codAfterPercent;
    }
    const weightIncrementRatio = Math.ceil(orderWeight / cv.incrementWeight);
    // console.log("weightIncrementRatio", weightIncrementRatio)
    totalCharge += increment_price.incrementPrice * weightIncrementRatio + cod;

    data2send.push({
      nickName: cv.nickName,
      name: cv.name,
      minWeight,
      charge: totalCharge,
      type: cv.type,
      expectedPickup,
      carrierID: cv.carrierID,
      order_zone,
    });
  }

  return data2send;
};

// Define types for pickup and delivery details
interface PincodePincode {
  District: string;
  StateName: string;
}

// Function to calculate the zone based on pickup and delivery pin codes
export const calculateZone = async (pickupPincode: PincodePincode, deliveryPincode: PincodePincode) => {
  const pickupDetails = await getPincodeDetails(Number(pickupPincode));
  const deliveryDetails = await getPincodeDetails(Number(deliveryPincode));
  if (!pickupDetails || !deliveryDetails) throw new Error("Invalid pickup or delivery pincode");

  if (pickupDetails.District === deliveryDetails.District) {
    return "Zone A";
  } else if (pickupDetails.StateName === deliveryDetails.StateName) {
    return "Zone B";
  } else if (
    MetroCitys.find((city) => city === pickupDetails?.District) &&
    MetroCitys.find((city) => city === deliveryDetails?.District)
  ) {
    return "Zone C";
  } else if (
    NorthEastStates.find((state) => state === pickupDetails?.StateName) &&
    NorthEastStates.find((state) => state === deliveryDetails?.StateName)
  ) {
    return "Zone E";
  } else {
    return "Zone D";
  }
};


// condition timing should be in the format: "hour:minute:second"
export const getNextDateWithDesiredTiming = (timing: string): Date => {
  const currentDate = new Date();
  const hour = Number(timing.split(":")[0]);
  const minute = Number(timing.split(":")[1]);
  const second = Number(timing.split(":")[2]);
  currentDate.setHours(hour, minute, second, 0);
  currentDate.setDate(currentDate.getDate() + 1);
  return currentDate;
};

export const getPincodeDetails = async (Pincode: number) => {
  const picodeDetails = await PincodeModel.findOne({ Pincode }).lean();
  return picodeDetails;
};

export const validateStringDate = (date: string): boolean => {
  const splittedDate = date.split("-");
  const splittedDateCount = splittedDate.length;

  if (splittedDateCount !== 3) {
    return false;
  }
  if (splittedDate[0].length !== 2 || splittedDate[1].length !== 2 || splittedDate[2].length !== 4) {
    return false;
  }
  return true;
};

export const MetroCitys = [
  "New Delhi",
  "MUMBAI",
  "Pune",
  "GURGAON",
  "KOLKATA",
  "Kolkata",
  "HYDERABAD",
  "Hyderabad",
  "CHENNAI",
  "Chennai",
  "Bangalore",
  "BENGALURU RURAL",
  "BENGALURU",
  "Ahmedabad City",
  "Ahmedabad",
];
export const NorthEastStates = ["Sikkim", "Mizoram", "Manipur", "Assam", "Megalaya", "Nagaland", "Tripura"];

export async function getSmartShipToken(): Promise<string | false> {
  const env = await EnvModel.findOne({ name: "SMARTSHIP" }).lean();
  if (!env) return false;
  //@ts-ignore
  const smartshipToken = "Bearer" + " " + env?.token;
  return smartshipToken;
  // }
}
export async function getSMARTRToken(): Promise<string | false> {
  const env = await EnvModel.findOne({ name: "SMARTR" }).lean();
  if (!env) return false;
  //@ts-ignore
  const token = "Bearer" + " " + env?.token;
  return token;
  // }
}

export async function getShiprocketToken(): Promise<string | false> {
  try {
    const env = await EnvModel.findOne({ name: "SHIPROCKET" }).lean();
    if (!env) return false;
    //@ts-ignore
    const token = "Bearer" + " " + env?.token;
    return token;
  } catch (error) {
    return false;
  }
}


export function getShiprocketBucketing(status: number) {
  const shiprocketStatusMapping = {
    // 13: { bucket: NEW, description: "Pickup Error" },
    // 15: { bucket: NEW, description: "Pickup Rescheduled" },
    // 19: { bucket: NEW, description: "Out For Pickup" },
    // 20: { bucket: NEW, description: "Pickup Exception" },
    // 27: { bucket: NEW, description: "Pickup Booked" },
    // 52: { bucket: NEW, description: "Shipment Booked" },
    // 54: { bucket: NEW, description: "In Transit Overseas" },
    // 55: { bucket: NEW, description: "Connection Aligned" },
    // 56: { bucket: NEW, description: "FC MANIFEST GENERATED" },


    6: { bucket: IN_TRANSIT, description: "Shipped" },
    7: { bucket: DELIVERED, description: "Delivered" },
    8: { bucket: CANCELED, description: "Canceled" },
    9: { bucket: RTO, description: "RTO Initiated" },
    10: { bucket: RTO, description: "RTO Delivered" },
    12: { bucket: LOST_DAMAGED, description: "Lost" },
    14: { bucket: RTO, description: "RTO Acknowledged" },
    16: { bucket: CANCELED, description: "Cancellation Requested" },
    17: { bucket: IN_TRANSIT, description: "Out For Delivery" },
    18: { bucket: IN_TRANSIT, description: "In Transit" },
    21: { bucket: NDR, description: "Undelivered" },
    22: { bucket: IN_TRANSIT, description: "Delayed" },
    23: { bucket: IN_TRANSIT, description: "Partial Delivered" },
    24: { bucket: LOST_DAMAGED, description: "Destroyed" },
    25: { bucket: LOST_DAMAGED, description: "Damaged" },
    26: { bucket: DELIVERED, description: "Fulfilled" },
    38: { bucket: IN_TRANSIT, description: "Reached At Destination Hub" },
    39: { bucket: IN_TRANSIT, description: "Misrouted" },
    40: { bucket: RTO, description: "RTO_NDR" },
    41: { bucket: RTO, description: "RTO_OFD" },
    42: { bucket: IN_TRANSIT, description: "Picked Up" },
    43: { bucket: DELIVERED, description: "Self Fulfilled" },
    44: { bucket: 8, description: "Disposed Off" },
    45: { bucket: CANCELED, description: "Cancelled Before Dispatched" },
    46: { bucket: RTO, description: "RTO In Intransit" },
    48: { bucket: IN_TRANSIT, description: "Reached Warehouse" },
    50: { bucket: IN_TRANSIT, description: "In Flight" },
    51: { bucket: IN_TRANSIT, description: "Handover To Courier" },
    75: { bucket: RTO, description: "RTO_LOCK" },
    76: { bucket: IN_TRANSIT, description: "UNTRACEABLE" },
    77: { bucket: IN_TRANSIT, description: "ISSUE_RELATED_TO_THE_RECIPIENT" },
    78: { bucket: RTO, description: "REACHED_BACK_AT_SELLER_CITY" },
    // Additional statuses omitted for brevity
  };
  return shiprocketStatusMapping[status as keyof typeof shiprocketStatusMapping] || { bucket: -1, description: "Status code not found" };
}



export function getSmartshipBucketing(status: number) {
  const smartshipStatusMapping = {

    // commented statuses are not using by the our tracking system 
    // 0: { bucket: NEW, description: "Open" },
    // 2: { bucket: NEW, description: "Confirmed" },
    // 3: { bucket: NEW, description: "Shipping Label Generated" },
    // 24: { bucket: NEW, description: "Courier Assigned" },
    // 4: { bucket: NEW, description: "Manifested" },


    10: { bucket: IN_TRANSIT, description: "Shipped" },
    27: { bucket: IN_TRANSIT, description: "In Transit" },
    30: { bucket: IN_TRANSIT, description: "Out For Delivery" },
    36: { bucket: IN_TRANSIT, description: "Handed Over to Courier" },
    207: { bucket: IN_TRANSIT, description: "Misrouted" },
    209: { bucket: IN_TRANSIT, description: "Destination Reached" },
    210: { bucket: IN_TRANSIT, description: "Delivery Not Attempted" },
    12: { bucket: NDR, description: "Delivery Attempted-Out Of Delivery Area" },
    13: { bucket: NDR, description: "Delivery Attempted-Address Issue / Wrong Address" },
    14: { bucket: NDR, description: "Delivery Attempted-COD Not ready" },
    15: { bucket: NDR, description: "Delivery Attempted-Customer Not Available/Contactable" },
    16: { bucket: NDR, description: "Delivery Attempted-Customer Refused To Accept Delivery" },
    17: { bucket: NDR, description: "Delivery Attempted-Requested for Future Delivery" },
    22: { bucket: NDR, description: "Delivery Attempted - Requested For Open Delivery" },
    23: { bucket: NDR, description: "Delivery Attempted - Others" },
    26: { bucket: NDR, description: "Cancellation Requested By Client" },
    59: { bucket: NDR, description: "In Transit Delay - ODA Location/ Area Not Accessible" },
    185: { bucket: NDR, description: "Cancelled By Client" },
    214: { bucket: NDR, description: "Delivery Attempted-Refused by Customer with OTP" },
    11: { bucket: DELIVERED, description: "Delivered" },
    48: { bucket: DELIVERED, description: "Delivery Confirmed by Customer" },
    18: { bucket: RTO, description: "Return To Origin" },
    19: { bucket: RTO, description: "RTO Delivered To Shipper" },
    28: { bucket: RTO, description: "RTO In Transit" },
    118: { bucket: RTO, description: "RTO to be Refunded" },
    198: { bucket: RTO, description: "RTO-Rejected by Merchant" },
    199: { bucket: RTO, description: "RTO-Delivered to FC" },
    212: { bucket: RTO, description: "RTO - In Transit - Damaged" },
    189: { bucket: LOST_DAMAGED, description: "Forward Shipment Lost" },
  };
  return smartshipStatusMapping[status as keyof typeof smartshipStatusMapping] || { bucket: -1, description: "Status code not found" };
}



export async function isSmartr_surface_servicable(pincode: number): Promise<boolean> {
  /*
  let config = {
    method: "get",
    maxBodyLength: Infinity,
    url: "https://uat.smartr.in/api/v1/pincode?pincode=122008",
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    headers: {
      Cookie:
        "csrftoken=1qesTyXbnnTIfNWLe8h8oAizJxVM8xtvTmZZRtoQhEdhH7KcfbywxXL892Qda2l4; sessionid=6rf0mzqk7pqif84y4se21hu9u63balbl",
    },
  };
 
  axios
    .request(config)
    .then((response) => {
      // console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      // console.log(error);
    });
  */
  // /*
  let response;
  const token = await getSMARTRToken();
  if (!token) return false;
  try {
    // console.log(APIs.PIN_CODE + "?pincode=122008");
    // console.log(token);
    response = await axios.get(APIs.PIN_CODE + `?pincode=${pincode}`, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        Authorization: token,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      // console.log(err.message);
      return false;
    } else {
      // console.log(err);
      return false;
    }
  }
  const data: PINCODE_RESPONSE = response.data;
  Logger.log("pincode response");
  Logger.log(data);
  Logger.log("pincode response");
  if (!data?.error && data.status === "failed") return false;
  if (data?.data) return true;
  return false;
}

type PINCODE_RESPONSE = {
  status: "failed" | "Success";
  error?: string;
  data: [
    {
      pincode: number;
      area_name: string;
      city_name: string;
      service_center: string;
      state_code: string;
      state_name: string;
      inbound: boolean;
      outbound: boolean;
      embargo: boolean;
      is_surface: boolean;
      region: string;
      country_code: string;
      zone: string;
      route_code: string;
      services: string;
      is_active: boolean;
    }
  ];
};
