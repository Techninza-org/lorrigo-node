import axios, { all } from "axios";
import config from "./config";
import EnvModel from "../models/env.model";
import { json, type NextFunction, type Request, type Response } from "express";
import CourierModel from "../models/courier.model";
import PincodeModel from "../models/pincode.model";
import SellerModel from "../models/seller.model";
import { ExtendedRequest } from "./middleware";
import APIs from "./constants/third_party_apis";
import Logger from "./logger";
import https from "node:https";
import mongoose, { isValidObjectId } from "mongoose";
import CustomPricingModel from "../models/custom_pricing.model";
import envConfig from "./config";
import { Types } from "mongoose";
import {
  CANCELED,
  DELIVERED,
  IN_TRANSIT,
  LOST_DAMAGED,
  NDR,
  READY_TO_SHIP,
  RTO,
  RETURN_CANCELLATION,
  RETURN_CANCELLED_BY_CLIENT,
  RETURN_CANCELLED_BY_SMARTSHIP,
  RETURN_CONFIRMED,
  RETURN_DELIVERED,
  RETURN_IN_TRANSIT,
  RETURN_ORDER_MANIFESTED,
  RETURN_OUT_FOR_PICKUP,
  RETURN_PICKED,
  RETURN_SHIPMENT_LOST,
  DISPOSED,
  RTO_DELIVERED,
  NEW,
} from "./lorrigo-bucketing-info";
import ChannelModel from "../models/channel.model";
import HubModel from "../models/hub.model";
import { calculateRateAndPrice, regionToZoneMappingLowercase } from "./B2B-helper";
import B2BCalcModel from "../models/b2b.calc.model";
import { B2COrderModel } from "../models/order.model";
import PaymentTransactionModal from "../models/payment.transaction.modal";
import InvoiceModel from "../models/invoice.model";
import ClientBillingModal from "../models/client.billing.modal";
import { formatCurrencyForIndia, generateListInoviceAwbs, updateSellerWalletBalance } from ".";
import { format, formatISO, parse } from "date-fns";
import NotInInvoiceAwbModel from "../models/not-billed-awbs-due-to-dispute.model";
import emailService from "./email.service";
import path from "path"

const { PDFDocument, rgb } = require("pdf-lib");
const fs = require("fs");

export const validateEmail = (email: string): boolean => {
  return /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)*[a-zA-Z]{2,}))$/.test(
    email
  );
};

export const validatePhone = (phone: number): boolean => {
  return phone > 999999999;
};

export const validateSmartShipServicablity = async (
  pickupPin: number,
  deliveryPin: number,
  weight: number,
  orderValue: number,
  length: number,
  width: number,
  height: number,
  paymentType: 0 | 1,
  shipmentType: number, // 0 for forward 1 for reverse

  prefferredCarrier: number[]
): Promise<any> => {
  const requestBody: any = {
    order_info: {
      email: "noreply@lorrigo.com",
      source_pincode: pickupPin,
      destination_pincode: deliveryPin,
      order_weight: weight,
      order_value: orderValue || 1000,
      payment_type: paymentType === 1 ? "cod" : "prepaid",
      length,
      width,
      height,
      shipment_type: shipmentType === 1 ? "return" : "forward",
      preferred_carriers: [...prefferredCarrier],
    },
    request_info: { extra_info: true, cost_info: false },
  };

  const smartshipToken = await getSmartShipToken();

  const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };

  try {
    const response = await axios.post(
      config.SMART_SHIP_API_BASEURL + APIs.RATE_CALCULATION,
      requestBody,
      smartshipAPIconfig
    );
    const responseData = response.data;
    const mappedCouriers = Object?.keys(responseData?.data?.carrier_info)?.map(
      (item: any) => responseData.data.carrier_info[item]
    );
    return mappedCouriers || [];
  } catch (err) {
    console.log(err, "err");
    return false;
  }

  return false;
};

export const addVendors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = new CourierModel(req.body);
    let savedVendor;
    try {
      savedVendor = await vendor.save();
    } catch (err) {
      return next(err);
    }
    return res.status(200).send({
      valid: true,
      vendor: savedVendor,
    });
  } catch (error) {
    return next(error);
  }
};

// B2C
export const updateVendor4Seller = async (req: Request, res: Response, next: NextFunction) => {
  try {
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
      if (!vendor) {
        const previouslySavedPricing = await CustomPricingModel.findById(vendorId).lean();
        if (previouslySavedPricing) {
          delete body.vendorId;
          // const savedPricing = await CustomPricingModel.findByIdAndUpdate(previouslySavedPricing._id, { ...body }, { new: true });

          let savedPricing = await CustomPricingModel.findOne({ vendorId: vendorId, sellerId: sellerId });
          savedPricing = await CustomPricingModel.findByIdAndUpdate(savedPricing?._id, { ...body }, { new: true });

          return res
            .status(200)
            .send({ valid: true, message: "Vendor not found. Custom pricing updated for user", savedPricing });
        } else {
          const toAdd = {
            vendorId: vendorId,
            sellerId: sellerId,
            ...body,
          };
          const savedPricing = new CustomPricingModel(toAdd);
          await savedPricing.save();
          return res
            .status(200)
            .send({ valid: true, message: "Vendor not found. Custom pricing created for user", savedPricing });
        }
      } else {
        // Vendor found, update its pricing
        delete body?.vendorId;
        delete body?.sellerId;
        const previouslySavedPricing = await CustomPricingModel.findOne({ sellerId, vendorId }).lean();
        let savedPricing;
        if (previouslySavedPricing) {
          // Update custom pricing
          savedPricing = await CustomPricingModel.findByIdAndUpdate(
            previouslySavedPricing._id,
            { ...body },
            { new: true }
          );
          return res.status(200).send({ valid: true, message: "Vendor priced updated for user", savedPricing });
        } else {
          const toAdd = {
            vendorId: vendorId,
            sellerId: sellerId,
            isRtoDeduct: vendor.isRtoDeduct,
            isFwdDeduct: vendor.isFwdDeduct,
            isCodDeduct: vendor.isCodDeduct,
            withinCity: vendor.withinCity,
            withinZone: vendor.withinZone,
            withinMetro: vendor.withinMetro,
            withinRoi: vendor.withinRoi,
            northEast: vendor.northEast,
            ...body,
          };

          savedPricing = new CustomPricingModel(toAdd);
          savedPricing = await savedPricing.save();
          return res.status(200).send({ valid: true, message: "Vendor priced updated for user", savedPricing });
        }
      }
      return res.status(200).send({ valid: false, message: "Incomplee " });
    } catch (err) {
      return next(err);
    }
    return res.status(200).send({ valid: false, message: "Not implemented yet" });
  } catch (error) {
    return next(error);
  }
};

export const getSellers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let { limit = 10, page = 1 }: { limit?: number; page?: number } = req.query;

    // Ensure that limit and page are valid numbers
    limit = isNaN(Number(limit)) ? 10 : Math.max(Number(limit), 1);
    page = isNaN(Number(page)) ? 1 : Math.max(Number(page), 1);

    const skip = (page - 1) * limit;

    const sellers = await SellerModel.find()
      .sort({ _id: -1 }) // Sort by _id in descending order
      // .skip(skip)
      // .limit(limit)
      .select("name isVerified email  billingAddress companyProfile bankDetails createdAt _id"); // Exclude the kycDetails field

    return res.status(200).json({
      valid: true,
      sellers: sellers,
    });
  } catch (err: any) {
    console.error("Error fetching sellers:", err);
    return res.status(500).json({
      valid: false,
      message: "An error occurred while fetching sellers.",
      error: err.message || "Unknown error",
    });
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
      cod: number;
      rtoCharges: number;
      charge: number;
      type: string;
      expectedPickup: string;
      carrierID: number;
      order_zone: string;
      nickName?: string;
    }[] = [];

    // Convert vendor IDs to ObjectId format
    // @ts-ignore
    const vendorIds = users_vendors.map(convertToObjectId).filter((id) => id !== null);

    // Check if any IDs failed to convert
    if (vendorIds.length !== users_vendors.length) {
      console.error("Some vendor IDs could not be converted.");
    }

    const vendors = await CourierModel.find({
      _id: { $in: vendorIds },
    })
      .populate("vendor_channel_id")
      .lean();

    const loopLength = vendors.length;

    for (let i = 0; i < loopLength; i++) {
      let orderWeight = volumetricWeight > Number(weight) ? volumetricWeight : Number(weight);
      const cv = vendors[i];

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
        NorthEastStates.find((state) => state === pickupDetails?.StateName) ||
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
      //@ts-ignore
      let totalCharge = 0;
      totalCharge += increment_price.basePrice;

      if (orderWeight < minWeight) {
        orderWeight = minWeight;
      }

      //@ts-ignore
      orderWeight = orderWeight - cv.weightSlab;
      const codPrice = cv.codCharge?.hard;
      const codAfterPercent = (cv.codCharge?.percent / 100) * body.collectableAmount;
      let cod = 0;
      if (body.paymentType === 1) {
        cod = codPrice > codAfterPercent ? codPrice : codAfterPercent;
      }
      const weightIncrementRatio = Math.ceil(orderWeight / cv.incrementWeight);
      totalCharge += increment_price.incrementPrice * weightIncrementRatio + cod;
      let rtoCharges = totalCharge - cod;

      data2send.push({
        name: cv.name,
        cod,
        rtoCharges,
        // @ts-ignore
        nickName: cv.vendor_channel_id.nickName,
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

export const B2BRatecalculatorController = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const body = req.body;
  const users_vendors = req.seller?.b2bVendors;

  const { deliveryPincode: toPin, pickupPincode: fromPin, amount, orderWeight } = body;

  const pickupPincode = Number(fromPin);
  const deliveryPincode = Number(toPin);

  const pickupPincodeData = await PincodeModel.findOne({ Pincode: pickupPincode }).exec();
  const deliveryPincodeData = await PincodeModel.findOne({ Pincode: deliveryPincode }).exec();

  if (!pickupPincodeData || !deliveryPincodeData) {
    throw new Error("Pincode data not found");
  }

  const fromRegionName = pickupPincodeData.District.toLowerCase(); // convert to lowercase
  const toRegionName = deliveryPincodeData.District.toLowerCase(); // convert to lowercase

  const Fzone = await regionToZoneMappingLowercase(fromRegionName);
  const Tzone = await regionToZoneMappingLowercase(toRegionName);

  if (!Fzone || !Tzone) {
    throw new Error("Zone not found for the given region");
  }

  let query: {
    _id: { $in: (Types.ObjectId | null)[] };
    isActive: boolean;
    isReversedCourier?: boolean;
  } = {
    _id: { $in: users_vendors },
    isActive: true,
    isReversedCourier: false,
  };

  const b2bCouriers = await B2BCalcModel.find(query).populate("vendor_channel_id");
  const courierDataPromises = b2bCouriers.map(async (courier) => {
    try {
      const result = await calculateRateAndPrice(
        courier,
        Fzone,
        Tzone,
        orderWeight,
        courier._id.toString(),
        fromRegionName,
        toRegionName,
        amount
      );

      const parterPickupTime = courier.pickupTime;
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

      return {
        // @ts-ignore
        nickName: courier.vendor_channel_id.nickName,
        name: courier.name,
        minWeight: 0.5,
        type: courier.type,
        carrierID: courier.carrierID,
        order_zone: `${Fzone}-${Tzone}`,
        charge: result.finalAmount,
        expectedPickup,
        ...result,
      };
    } catch (error) {
      console.log(error);
      return null;
    }
  });

  const courierData = await Promise.all(courierDataPromises);
  const b2bCouriersData = courierData.filter((data) => data !== null);

  return res.status(200).send({ valid: true, rates: b2bCouriersData });
};

const convertToObjectId = (id: string) => {
  try {
    return new Types.ObjectId(id);
  } catch (error) {
    console.error(`Invalid ObjectId: ${id}`);
    return null;
  }
};

export const rateCalculation = async ({
  shiprocketOrderID,
  pickupPincode,
  deliveryPincode,
  weight,
  weightUnit,
  boxLength,
  boxWidth,
  boxHeight,
  sizeUnit,
  paymentType,
  users_vendors,
  seller_id,
  wantCourierData = false,
  collectableAmount,
  isReversedOrder,
  orderRefId,
}:{
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
  wantCourierData: boolean,
  collectableAmount?: any,
  isReversedOrder?: boolean,
  orderRefId?: string,

}): Promise<{
  name: string;
  cod: number;
  minWeight: number;
  charge: number;
  isReversedCourier: boolean;
  rtoCharges: number;
  type: string;
  expectedPickup: string;
  carrierID: string;
  order_zone: string;
  nickName?: string;
  orderRefId?: string;
}[] | {message: string}[]> => {
  try {
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

    const vendorIds = users_vendors.map(convertToObjectId).filter((id) => id !== null);

    let query: {
      _id: { $in: (Types.ObjectId | null)[] };
      isActive: boolean;
      isReversedCourier?: boolean;
    } = {
      _id: { $in: vendorIds },
      isActive: true,
      isReversedCourier: false,
    };

    if (isReversedOrder) {
      query.isReversedCourier = true;
    }

    const vendors = await CourierModel.find(query);
    console.log(vendors.length, "vendors")

    let commonCouriers: any[] = [];

    try {
      const token = await getShiprocketToken();
      if (!token) return [{ message: "Invalid Shiprocket token" }];

      const url =
        envConfig.SHIPROCKET_API_BASEURL +
        APIs.SHIPROCKET_ORDER_COURIER +
        `/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${paymentType}&order_id=${shiprocketOrderID}`;

       // https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=201301&delivery_postcode=491881&weight=0.23&cod=1&order_id=791300583 
       console.log(url, "url") 
      const config = {
        headers: {
          Authorization: token,
        },
      };

      const response = await axios.get(url, config);
      const courierCompanies = response?.data?.data?.available_courier_companies;
      console.log("shiprocket-----courierCompanies")

      const shiprocketNiceName = await EnvModel.findOne({ name: "SHIPROCKET" }).select("_id nickName");
      vendors?.forEach((vendor: any) => {
        const courier = courierCompanies?.find((company: { courier_company_id: number }) => {
          if (company.courier_company_id === 369) return false;
          return company.courier_company_id === vendor.carrierID;
        });

        if (courier && shiprocketNiceName) {
          const shiprocketVendors = vendors.filter((vendor) => {
            return courier.courier_company_id === vendor.carrierID;
          });

          if (shiprocketVendors.length > 0) {
            commonCouriers.push({
              ...vendor.toObject(),
              nickName: shiprocketNiceName.nickName,
            });
          }
        }
      });
    } catch (error) {
      console.log("error", error);
    }

    try {
      const smartShipCouriers = await validateSmartShipServicablity(
        pickupPincode,
        deliveryPincode,
        weight,
        collectableAmount,
        boxLength,
        boxWidth,
        boxHeight,
        paymentType,
        isReversedOrder ? 1 : 0,
        []
      );

      console.log("smartShipCouriers-----courierCompanies")

      const smartShipNiceName = await EnvModel.findOne({ name: "SMARTSHIP" }).select("_id nickName");

      vendors?.forEach((vendor: any) => {
        const courier = smartShipCouriers?.find((company: { carrier_id: string }) => {
          return Number(company.carrier_id) === vendor.carrierID;
        });
        if (courier && smartShipNiceName) {
          const smartShipVendors = vendors.filter((vendor) => {
            return vendor.carrierID === Number(courier.carrier_id);
          });

          if (smartShipVendors.length > 0) {
            smartShipVendors.forEach((vendor) => {
              commonCouriers.push({
                ...vendor.toObject(),
                nickName: smartShipNiceName.nickName,
              });
            });
          }
        }
      });
    } catch (error) {
      console.log("error", error);
    }

    // try {
    //   const smartrToken = await getSMARTRToken();
    //   if (!smartrToken) {
    //     throw new Error("Failed to retrieve SMARTR token");
    //   }

    //   const isSMARTRServicable = await axios.get(
    //     `${config.SMARTR_API_BASEURL}${APIs.SMARTR_PINCODE_SERVICEABILITY}?pincode=${deliveryPincode}`,
    //     {
    //       headers: {
    //         Authorization: `${smartrToken}`,
    //       },
    //     }
    //   );

    //   if (!isSMARTRServicable.data.errors) {
    //     const smartrNiceName = await EnvModel.findOne({ name: "SMARTR" }).select("_id nickName");
    //     if (smartrNiceName) {
    //       const smartrVendors = vendors.filter(
    //         (vendor) => vendor?.vendor_channel_id?.toString() === smartrNiceName._id.toString()
    //       );
    //       if (smartrVendors.length > 0) {
    //         smartrVendors.forEach((vendor) => {
    //           commonCouriers.push({
    //             ...vendor.toObject(),
    //             nickName: smartrNiceName.nickName,
    //           });
    //         });
    //       }
    //     }
    //   }
    // } catch (error) {
    //   console.log("error", error);
    // }

    try {
      const delhiveryToken = await getDelhiveryToken();
      if (!delhiveryToken) {
        throw new Error("Failed to retrieve Delhivery token");
      }

      const isDelhiveryServicable = await axios.get(
        `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_PINCODE_SERVICEABILITY}${deliveryPincode}`,
        {
          headers: {
            Authorization: `${delhiveryToken}`,
          },
        }
      );

      console.log("delhiveryToken-----courierCompanies")


      if (!!isDelhiveryServicable.data.delivery_codes[0]) {
        const delhiveryNiceName = await EnvModel.findOne({ name: "DELHIVERY" }).select("_id nickName");
        if (delhiveryNiceName) {
          const delhiveryVendors = vendors.filter((vendor) => {
            return vendor?.vendor_channel_id?.toString() === delhiveryNiceName._id.toString();
          });

          if (delhiveryVendors.length > 0) {
            delhiveryVendors.forEach((vendor) => {
              commonCouriers.push({
                ...vendor.toObject(),
                nickName: delhiveryNiceName.nickName,
              });
            });
          }
        }
      }
    } catch (error) {
      console.log("error", error);
    }

    try {
      const delhiveryToken = await getDelhiveryTokenPoint5();
      if (!delhiveryToken) {
        throw new Error("Failed to retrieve Delhivery token");
      }

      const isDelhiveryServicable = await axios.get(
        `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_PINCODE_SERVICEABILITY}${deliveryPincode}`,
        {
          headers: {
            Authorization: `${delhiveryToken}`,
          },
        }
      );

      console.log("delhiveryToken1-----courierCompanies")

      if (!!isDelhiveryServicable.data.delivery_codes[0]) {
        const delhiveryNiceName = await EnvModel.findOne({ name: "DELHIVERY_0.5" }).select("_id nickName");
        if (delhiveryNiceName) {
          const delhiveryVendors = vendors.filter((vendor) => {
            return vendor?.vendor_channel_id?.toString() === delhiveryNiceName._id.toString();
          });
          if (delhiveryVendors.length > 0) {
            delhiveryVendors.forEach((vendor) => {
              commonCouriers.push({
                ...vendor.toObject(),
                nickName: delhiveryNiceName.nickName,
              });
            });
          }
        }
      }
    } catch (error) {
      console.log("error", error);
    }

    try {
      const delhiveryToken = await getDelhiveryToken10();
      if (!delhiveryToken) {
        throw new Error("Failed to retrieve Delhivery token");
      }

      const isDelhiveryServicable = await axios.get(
        `${config.DELHIVERY_API_BASEURL}${APIs.DELHIVERY_PINCODE_SERVICEABILITY}${deliveryPincode}`,
        {
          headers: {
            Authorization: `${delhiveryToken}`,
          },
        }
      );

      console.log("delhiveryToken2-----courierCompanies")


      if (!!isDelhiveryServicable.data.delivery_codes[0]) {
        const delhiveryNiceName = await EnvModel.findOne({ name: "DELHIVERY_10" }).select("_id nickName");
        if (delhiveryNiceName) {
          const delhiveryVendors = vendors.filter((vendor) => {
            return vendor?.vendor_channel_id?.toString() === delhiveryNiceName._id.toString();
          });
          if (delhiveryVendors.length > 0) {
            delhiveryVendors.forEach((vendor) => {
              commonCouriers.push({
                ...vendor.toObject(),
                nickName: delhiveryNiceName.nickName,
              });
            });
          }
        }
      }
    } catch (error) {
      console.log("error", error);
    }

    //marutiToken
    // try {
    //   const marutiToken = await getMarutiToken();

    //   if (!marutiToken) {
    //     throw new Error("Failed to retrieve Maruti token");
    //   }

    //   // TODO: check order is for AIR or SURFACE

    //   const marutiRequestBodySurface = {
    //     fromPincode: pickupPincode,
    //     toPincode: deliveryPincode,
    //     isCodOrder: paymentType === 1,
    //     deliveryMode: "SURFACE",
    //   };

    //   console.log(marutiRequestBodySurface, "marutiRequestBodySurface");

    //   const isMarutiServicableSurface = await axios.post(
    //     `${envConfig.MARUTI_BASEURL}${APIs.MARUTI_SERVICEABILITY}`,
    //     marutiRequestBodySurface
    //   );
    //   const isMSSurface = isMarutiServicableSurface.data.data.serviceability;

    //   console.log("isMSSurface", isMarutiServicableSurface.data);

    //   if (isMSSurface) {
    //     const marutiNiceName = await EnvModel.findOne({ name: "MARUTI" }).select("_id nickName");
    //     if (marutiNiceName) {
    //       const marutiVendors = vendors.filter((vendor) => {
    //         return (
    //           vendor?.vendor_channel_id?.toString() === marutiNiceName._id.toString() && vendor?.type === "surface"
    //         );
    //       });
    //       if (marutiVendors.length > 0) {
    //         marutiVendors.forEach((vendor) => {
    //           commonCouriers.push({
    //             ...vendor.toObject(),
    //             nickName: marutiNiceName.nickName,
    //           });
    //         });
    //       }
    //     }
    //   }

    //   const marutiRequestBodyAir = {
    //     fromPincode: pickupPincode,
    //     toPincode: deliveryPincode,
    //     isCodOrder: paymentType === 1,
    //     deliveryMode: "AIR",
    //   };

    //   const isMarutiServicableAir = await axios.post(
    //     `${envConfig.MARUTI_BASEURL}${APIs.MARUTI_SERVICEABILITY}`,
    //     marutiRequestBodyAir
    //   );
    //   const isMSAir = isMarutiServicableAir.data.data.serviceability;

    //   if (isMSAir) {
    //     const marutiNiceName = await EnvModel.findOne({ name: "MARUTI" }).select("_id nickName");
    //     if (marutiNiceName) {
    //       const marutiVendors = vendors.filter((vendor) => {
    //         return vendor?.vendor_channel_id?.toString() === marutiNiceName._id.toString() && vendor?.type === "air";
    //       });
    //       if (marutiVendors.length > 0) {
    //         marutiVendors.forEach((vendor) => {
    //           commonCouriers.push({
    //             ...vendor.toObject(),
    //             nickName: marutiNiceName.nickName,
    //           });
    //         });
    //       }
    //     }
    //   }
    // } catch (error) {
    //   console.log("error", error);
    // }

    const data2send: {
      name: string;
      cod: number;
      minWeight: number;
      charge: number;
      isReversedCourier: boolean;
      rtoCharges: number;
      type: string;
      expectedPickup: string;
      carrierID: string;
      order_zone: string;
      nickName?: string;
      orderRefId?: string;
      courier?: any;
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
        cv.isFwdDeduct = userSpecificUpdatedVendorDetails[0]?.isFwdDeduct ?? true;
        cv.isRtoDeduct = userSpecificUpdatedVendorDetails[0]?.isRtoDeduct ?? true;
        cv.isCodDeduct = userSpecificUpdatedVendorDetails[0]?.isCodDeduct ?? true;

        cv.codCharge = userSpecificUpdatedVendorDetails[0]?.codCharge;

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
        NorthEastStates.find((state) => state === pickupDetails?.StateName) ||
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
      //@ts-ignore
      let totalCharge = 0;
      totalCharge += increment_price.basePrice;

      if (orderWeight < minWeight) {
        orderWeight = minWeight;
      }

      const isFwdDeduct = cv.isFwdDeduct === undefined ? true : Boolean(cv.isFwdDeduct);
      const isRtoDeduct = cv.isRtoDeduct === undefined ? true : Boolean(cv.isRtoDeduct);
      const isCodDeduct = cv.isCodDeduct === undefined ? true : Boolean(cv.isCodDeduct);
      const isRTOSameAsFW = increment_price?.isRTOSameAsFW === undefined ? true : Boolean(increment_price?.isRTOSameAsFW);

      const codPrice = cv.codCharge?.hard;
      const codAfterPercent = (cv.codCharge?.percent / 100) * collectableAmount;
      let cod = 0;
      if (paymentType === 1) {
        cod = isCodDeduct ? (codPrice > codAfterPercent ? codPrice : codAfterPercent) : 0;
      }

      const weightIncrementRatio = Math.ceil((orderWeight - minWeight) / cv.incrementWeight);
      totalCharge += increment_price.incrementPrice * weightIncrementRatio + cod;
      let rtoCharges =  0;
      
      if (isRtoDeduct) {
        rtoCharges =  !isRTOSameAsFW ? (increment_price?.rtoBasePrice ?? 0) + ((increment_price?.rtoIncrementPrice ?? 0) * weightIncrementRatio ):  (totalCharge - cod)
      }

      data2send.push({
        nickName: cv.nickName,
        name: cv.name,
        minWeight,
        cod,
        isReversedCourier: cv.isReversedCourier,
        rtoCharges,
        charge: isFwdDeduct ? totalCharge : 0,
        type: cv.type,
        expectedPickup,
        carrierID: cv._id,
        order_zone,
        orderRefId: orderRefId,
        ...(wantCourierData ? { courier: cv } : {})
      });
    }

    return data2send;
  } catch (error) {
    return [{ message: "error: " + (error as Error).message }];
  }
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
    return "A";
  } else if (pickupDetails.StateName === deliveryDetails.StateName) {
    return "B";
  } else if (
    MetroCitys.find((city) => city === pickupDetails?.District) &&
    MetroCitys.find((city) => city === deliveryDetails?.District)
  ) {
    return "C";
  } else if (
    NorthEastStates.find((state) => state === pickupDetails?.StateName) ||
    NorthEastStates.find((state) => state === deliveryDetails?.StateName)
  ) {
    return "E";
  } else {
    return "D";
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
  "Delhi",
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
  "AHMEDABAD",
];
export const NorthEastStates = [
  "Sikkim",
  "Mizoram",
  "Manipur",
  "Assam",
  "Megalaya",
  "Nagaland",
  "Tripura",
  "Jammu and Kashmir",
  "Himachal Pradesh",
];

export async function getShiprocketB2BConfig(): Promise<any> {
  try {
    const env = await EnvModel.findOne({ name: "SHIPROCKET_B2B" }).lean();
    if (!env) return false;
    const token = "Bearer" + " " + env?.token;
    return {
      //@ts-ignore
      clientId: env.client_id,
      refreshToken: env.refreshToken,
      token,
    };
  } catch (error) {
    return false;
  }
}

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

export async function getDelhiveryToken() {
  const env = await EnvModel.findOne({ name: "DELHIVERY" }).lean();
  if (!env) return false;
  //@ts-ignore
  const token = "Token" + " " + env?.token;
  return token;
}
export async function getDelhiveryTokenPoint5() {
  const env = await EnvModel.findOne({ name: "DELHIVERY_0.5" }).lean();
  if (!env) return false;
  //@ts-ignore
  const token = "Token" + " " + env?.token;
  return token;
}
export async function getDelhiveryToken10() {
  const env = await EnvModel.findOne({ name: "DELHIVERY_10" }).lean();
  if (!env) return false;
  //@ts-ignore
  const token = "Token" + " " + env?.token;
  return token;
}

  export const getDelhiveryTkn = async (type: any) => {
    switch (type) {
      case "DELHIVERY":
        return await getDelhiveryToken();
      case "DELHIVERY_0.5":
        return await getDelhiveryTokenPoint5();
      case "DELHIVERY_10":
        return await getDelhiveryToken10();
      default:
        return null;
    }
  };

export async function getEcommToken() {
  const env = await EnvModel.findOne({ name: "ECOMM" }).lean();
  if (!env) return false;
  // @ts-ignore
  return { username: env.email, password: env.password };
}

export async function getSellerChannelConfig(sellerId: string) {
  try {
    const channel = await ChannelModel.findOne({ sellerId }).lean();
    const { sharedSecret, storeUrl } = channel as { sharedSecret: string; storeUrl: string };
    return { sharedSecret, storeUrl };
  } catch (error) {
    console.log("error", error);
  }
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

export async function getMarutiToken() {
  const env = await EnvModel.findOne({ name: "MARUTI" }).lean();
  if (!env) return false;
  //@ts-ignore
  const token = "Bearer" + " " + env?.token;
  return token;
}

export async function getZohoConfig() {
  try {
    const env = await EnvModel.findOne({ name: "ZOHO" }).lean();
    if (!env) return false;
    //@ts-ignore
    return { accessToken: env.access_token, refreshToken: env.refresh_token };
  } catch (error) {
    return false;
  }
}

export function getMarutiBucketing(status: number) {
  const marutiStatusMapping = {
    6: { bucket: IN_TRANSIT, description: "Shipped" },
    7: { bucket: DELIVERED, description: "Delivered" },
    8: { bucket: CANCELED, description: "Canceled" },
    9: { bucket: RTO, description: "RTO Initiated" },
    10: { bucket: RTO_DELIVERED, description: "RTO Delivered" },
    12: { bucket: LOST_DAMAGED, description: "Lost" },
    13: { bucket: READY_TO_SHIP, description: "Pickup Error" },
    14: { bucket: RTO, description: "RTO Acknowledged" },
    15: { bucket: READY_TO_SHIP, description: "Pickup Rescheduled" },
    16: { bucket: CANCELED, description: "Cancellation Requested" },
    17: { bucket: IN_TRANSIT, description: "Out For Delivery" },
    18: { bucket: IN_TRANSIT, description: "In Transit" },
    19: { bucket: READY_TO_SHIP, description: "Out For Pickup" },
    20: { bucket: READY_TO_SHIP, description: "Pickup Exception" },
    21: { bucket: NDR, description: "Undelivered" },
    22: { bucket: IN_TRANSIT, description: "Delayed" },
    23: { bucket: DELIVERED, description: "Partial Delivered" },
    24: { bucket: LOST_DAMAGED, description: "Destroyed" },
    25: { bucket: LOST_DAMAGED, description: "Damaged" },
    26: { bucket: DELIVERED, description: "Fulfilled" },
    27: { bucket: READY_TO_SHIP, description: "Pickup Booked" },
    38: { bucket: IN_TRANSIT, description: "Reached At Destination Hub" },
    39: { bucket: IN_TRANSIT, description: "Misrouted" },
    40: { bucket: RTO, description: "RTO_NDR" },
    41: { bucket: RTO, description: "RTO_OFD" },
    42: { bucket: IN_TRANSIT, description: "Picked Up" },
    43: { bucket: DELIVERED, description: "Self Fulfilled" },
    44: { bucket: DISPOSED, description: "Disposed Off" },
    45: { bucket: CANCELED, description: "Cancelled Before Dispatched" },
    46: { bucket: RTO, description: "RTO In Intransit" },
    48: { bucket: IN_TRANSIT, description: "Reached Warehouse" },
    50: { bucket: IN_TRANSIT, description: "In Flight" },
    51: { bucket: IN_TRANSIT, description: "Handover To Courier" },
    52: { bucket: READY_TO_SHIP, description: "Shipment Booked" },
    54: { bucket: IN_TRANSIT, description: "In Transit Overseas" },
    55: { bucket: IN_TRANSIT, description: "Connection Aligned" },
    56: { bucket: IN_TRANSIT, description: "REACHED WAREHOUSE OVERSEAS" },
    57: { bucket: IN_TRANSIT, description: "Custom Cleared Overseas" },
    67: { bucket: READY_TO_SHIP, description: "FC MANIFEST GENERATED" },
    75: { bucket: RTO, description: "RTO_LOCK" },
    76: { bucket: IN_TRANSIT, description: "UNTRACEABLE" },
    77: { bucket: NDR, description: "ISSUE_RELATED_TO_THE_RECIPIENT" },
    78: { bucket: RTO, description: "REACHED_BACK_AT_SELLER_CITY" },
  };
  return (
    marutiStatusMapping[status as keyof typeof marutiStatusMapping] || {
      bucket: -1,
      description: "Status code not found",
    }
  );
}

export function getShiprocketBucketing(status: number) {
  const shiprocketStatusMapping = {
    // 13: { bucket: NEW, description: "Pickup Error" },
    // 15: { bucket: NEW, description: "Pickup Rescheduled" },
    // 20: { bucket: NEW, description: "Pickup Exception" },
    // 27: { bucket: NEW, description: "Pickup Booked" },
    // 52: { bucket: NEW, description: "Shipment Booked" },
    // 54: { bucket: NEW, description: "In Transit Overseas" },
    // 55: { bucket: NEW, description: "Connection Aligned" },
    // 56: { bucket: NEW, description: "FC MANIFEST GENERATED" },
    
    'NA': { bucket: READY_TO_SHIP, stage: 67, description: "Pickup Scheduled" },
    6: { bucket: IN_TRANSIT, description: "Shipped" },
    7: { bucket: DELIVERED, description: "Delivered" },
    8: { bucket: CANCELED, description: "Canceled" },
    9: { bucket: RTO, description: "RTO Initiated" },
    10: { bucket: RTO_DELIVERED, description: "RTO Delivered" },
    12: { bucket: LOST_DAMAGED, description: "Lost" },
    14: { bucket: RTO, description: "RTO Acknowledged" },
    15: { bucket: READY_TO_SHIP, description: "Customer Not Available/Contactable" },
    16: { bucket: CANCELED, description: "Cancellation Requested" },
    17: { bucket: IN_TRANSIT, description: "Out For Delivery" },
    18: { bucket: IN_TRANSIT, description: "In Transit" },
    19: { bucket: READY_TO_SHIP, stage: 52, description: "Out For Pickup" },
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
  return (
    shiprocketStatusMapping[status as keyof typeof shiprocketStatusMapping] || {
      bucket: -1,
      description: "Status code not found",
    }
  );
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
    19: { bucket: RTO_DELIVERED, description: "RTO Delivered To Shipper" },
    28: { bucket: RTO, description: "RTO In Transit" },
    118: { bucket: RTO, description: "RTO to be Refunded" },
    198: { bucket: RTO, description: "RTO-Rejected by Merchant" },
    199: { bucket: RTO_DELIVERED, description: "RTO-Delivered to FC" },
    212: { bucket: RTO, description: "RTO - In Transit - Damaged" },
    189: { bucket: LOST_DAMAGED, description: "Forward Shipment Lost" },

    // Return order Bucketing
    163: { bucket: RETURN_CONFIRMED, description: "Return Confirmed by Customer" },
    168: { bucket: RETURN_ORDER_MANIFESTED, description: "Return Order Manifested" },
    169: { bucket: RETURN_PICKED, description: "Return Order Picked" },
    170: { bucket: RETURN_CANCELLATION, description: "Return Order Cancelled" },
    171: { bucket: RETURN_DELIVERED, description: "Return Order Delivered" },
    172: { bucket: RETURN_OUT_FOR_PICKUP, description: "Return Order Out for Pickup" },
    173: { bucket: RETURN_IN_TRANSIT, description: "Return Order In Transit" },
    187: { bucket: RETURN_CANCELLED_BY_SMARTSHIP, description: "Return Cancelled by Smartship" },
    188: { bucket: RETURN_CANCELLED_BY_CLIENT, description: "Return Cancelled by Client" },
    190: { bucket: RETURN_SHIPMENT_LOST, description: "Return Shipment Lost" },
  };
  return (
    smartshipStatusMapping[status as keyof typeof smartshipStatusMapping] || {
      bucket: -1,
      description: "Status code not found",
    }
  );
}

export function getSmartRBucketing(status: string, reasonCode: string) {
  type SSTYPE = {
    description: string;
    reasonCode?: string;
    bucket: number;
  };

  const smarRBuckets: Record<string, SSTYPE[]> = {
    // "MAN": [{ description: "Shipment manifested", bucket: NEW }],

    CAN: [{ description: "Shipment Cancelled", bucket: CANCELED }],
    PKA: [{ description: "Pickup assigned", bucket: READY_TO_SHIP }],
    PKU: [{ description: "Pickup un-assigned", bucket: CANCELED }],
    OFP: [{ description: "Out for Pickup", bucket: READY_TO_SHIP }],
    PKF: [
      { description: "Pickup Failed", bucket: READY_TO_SHIP },
      { description: "Package Not Travel Worthy; Shipment Hold", reasonCode: "PF001", bucket: IN_TRANSIT },
      { description: "Change In Product-On Shippers Request on Fresh AWB", reasonCode: "PF002", bucket: CANCELED },
      { description: "Shipment Not Connected-Space Constraint", reasonCode: "PF003", bucket: IN_TRANSIT },
      { description: "Shipment Returned Back to Shipper", reasonCode: "PF004", bucket: RTO },
      { description: "Missed Pickup- Reached Late", reasonCode: "PF005", bucket: READY_TO_SHIP },
      { description: "Pickup Declined-Prohibited Content", reasonCode: "PF006", bucket: READY_TO_SHIP },
      {
        description: "Pickup Not Done - Destination Pin Code Not Serviceable",
        reasonCode: "PF007",
        bucket: READY_TO_SHIP,
      },
      { description: "Pickup Wrongly Registered By Shipper", reasonCode: "PF008", bucket: READY_TO_SHIP },
      { description: "Pickup Not Done - Contact Person Not Available", reasonCode: "PF009", bucket: READY_TO_SHIP },
      { description: "Shipment Not Ready or No Shipment Today", reasonCode: "PF010", bucket: READY_TO_SHIP },
      { description: "Pickup Cancelled By Shipper", reasonCode: "PF011", bucket: READY_TO_SHIP },
      { description: "Holiday- Shipper Closed", reasonCode: "PF012", bucket: READY_TO_SHIP },
      { description: "Shippers or Consignee Request to Hold at Location", reasonCode: "PF013", bucket: READY_TO_SHIP },
      {
        description: "Shipment Manifested But Not Received By Destination",
        reasonCode: "PF014",
        bucket: READY_TO_SHIP,
      },
      { description: "Disturbance or Natural Disaster or Strike", reasonCode: "PF015", bucket: READY_TO_SHIP },
      { description: "Shipment Lost", reasonCode: "PF016", bucket: READY_TO_SHIP },
      { description: "Shipment Held-Regulartory Paperworks Required", reasonCode: "PF017", bucket: READY_TO_SHIP },
      { description: "Security Cleared", reasonCode: "PF018", bucket: READY_TO_SHIP },
      { description: "Shipment or Package Damaged", reasonCode: "PF019", bucket: READY_TO_SHIP },
      { description: "Canvas Bag or shipment received short", reasonCode: "PF021", bucket: READY_TO_SHIP },
    ],
    PKD: [{ description: "Shipment Picked up", bucket: IN_TRANSIT }],
    IND: [{ description: "Shipment Inscan at facility", bucket: IN_TRANSIT }],
    BGD: [{ description: "Shipment Bagged", bucket: IN_TRANSIT }],
    BGU: [{ description: "Shipment de-Bagged", bucket: IN_TRANSIT }],
    DPD: [{ description: "Shipment Departed", bucket: IN_TRANSIT }],
    ARD: [{ description: "Shipment Arrived", bucket: IN_TRANSIT }],
    RDC: [{ description: "Shipment Reached at DC", bucket: IN_TRANSIT }],
    OFD: [{ description: "Out for Delivery", bucket: IN_TRANSIT }],
    SUD: [
      { description: "Undelivered", bucket: IN_TRANSIT },
      { description: "Shippers or Consignee Request to Hold at Location", reasonCode: "UD001", bucket: NDR },
      { description: "Non Serviceable Area or Pin code", reasonCode: "UD002", bucket: NDR },
      { description: "Residence or Office Closed", reasonCode: "UD003", bucket: NDR },
      { description: "Holiday:Scheduled for Delivery on Next Working Day", reasonCode: "UD004", bucket: IN_TRANSIT },
      { description: "Address Incomplete or Incorrect Can not Deliver", reasonCode: "UD005", bucket: NDR },
      { description: "Consignee Refused To Accept", reasonCode: "UD006", bucket: NDR },
      { description: "No Such Consignee At Given Address", reasonCode: "UD007", bucket: NDR },
      { description: "Consignee Not Available At Given Address", reasonCode: "UD008", bucket: NDR },
      { description: "Consignee Shifted", reasonCode: "UD009", bucket: NDR },
      { description: "Tender Schedule Expired", reasonCode: "UD010", bucket: NDR },
      { description: "Disturbance or Natural Disaster or Strike", reasonCode: "UD011", bucket: NDR },
      { description: "Consignee Not Yet Checked In", reasonCode: "UD012", bucket: NDR },
      { description: "Consignee Out Of Station", reasonCode: "UD013", bucket: NDR },
      { description: "Shipment Lost", reasonCode: "UD014", bucket: LOST_DAMAGED },
      { description: "Shipment Destroyed or Abandoned", reasonCode: "UD015", bucket: LOST_DAMAGED },
      { description: "Shipment Redirected to Alternate Address", reasonCode: "UD016", bucket: IN_TRANSIT },
      { description: "Package Interchanged At Org or Dest", reasonCode: "UD017", bucket: NDR },
      {
        description: "Late Arrival or Scheduled For Next Working Day Delivery",
        reasonCode: "UD019",
        bucket: IN_TRANSIT,
      },
      { description: "Shipment Held-Regulartory Paperworks Required", reasonCode: "UD020", bucket: IN_TRANSIT },
      { description: "Shipment Misrouted In Network", reasonCode: "UD021", bucket: IN_TRANSIT },
      { description: "Schedule for Next Business Day Delivery", reasonCode: "UD022", bucket: IN_TRANSIT },
      { description: "Security Cleared", reasonCode: "UD024", bucket: IN_TRANSIT },
      { description: "Shipment or Package Damaged", reasonCode: "UD025", bucket: LOST_DAMAGED },
      { description: "Shipment Partially Delivered", reasonCode: "UD026", bucket: DELIVERED },
      { description: "Attempt in Secondary Address", reasonCode: "UD028", bucket: IN_TRANSIT },
      { description: "SHIPMENT RECEIVED;PAPERWORK NOT RECEIVED", reasonCode: "UD029", bucket: IN_TRANSIT },
      { description: "DOD or FOD or COD not ready", reasonCode: "UD030", bucket: NDR },
      { description: "Entry restricted, no response on call", reasonCode: "UD031", bucket: NDR },
      { description: "No response from consignee", reasonCode: "UD032", bucket: NDR },
      { description: "OTP NOT RECEIVED BY CONSIGNEE", reasonCode: "UD033", bucket: NDR },
    ],
    DDL: [{ description: "Delivered", bucket: DELIVERED }],
    SDL: [{ description: "Delivered-Self Pickup", bucket: DELIVERED }],
    PDL: [{ description: "Delivered-partially", bucket: DELIVERED }],
    RTL: [{ description: "RTO Locked", bucket: RTO }],
    RTR: [{ description: "RTO Lock Revoked", bucket: IN_TRANSIT }],
    RTS: [{ description: "Return to Shipper", bucket: RTO }],
    RTD: [{ description: "RTO Delivered", bucket: RTO_DELIVERED }],
    LST: [{ description: "Shipment Lost", bucket: LOST_DAMAGED }],
    DMG: [{ description: "Damaged", bucket: LOST_DAMAGED }],
    DSD: [{ description: "Destroyed", bucket: LOST_DAMAGED }],
    DLD: [{ description: "Delayed", bucket: IN_TRANSIT }],
    HLD: [{ description: "Hold", bucket: IN_TRANSIT }],
  };
  const smarRPossibleResponse = smarRBuckets[status]?.find(
    (statusD) => !statusD.reasonCode || statusD.reasonCode === reasonCode
  );

  return smarRPossibleResponse
    ? { bucket: smarRPossibleResponse.bucket, description: smarRPossibleResponse.description }
    : { bucket: -1, description: "Status code not found" };
}

type DelhiveryBucket = {
  bucket: number;
  description: string;
};

export function getDelhiveryBucketing(scanDetail: { ScanType: string; Scan: string }): DelhiveryBucket {
  const forwardStatusMapping = {
    "In Transit": { bucket: IN_TRANSIT, description: "In Transit" },
    Pending: { bucket: IN_TRANSIT, description: "In Transit" },
    Delivered: { bucket: DELIVERED, description: "Delivered" },
    Dispatched: { bucket: IN_TRANSIT, description: "Out for Delivery" },
    RTO: { bucket: RTO, description: "Return to Origin (RTO)" },
    DTO: { bucket: RTO_DELIVERED, description: "Return Delivered" },
    Returned: { bucket: RETURN_CONFIRMED, description: "Return Delivered" },
    LOST: { bucket: LOST_DAMAGED, description: "Lost or Damaged" },
  };

  // RTO Status Mapping
  const rtoStatusMapping = {
    "In Transit": { bucket: RTO, description: "In Transit" },
    Pending: { bucket: RTO, description: "In Transit" },
    Delivered: { bucket: RTO, description: "Delivered" },
    Dispatched: { bucket: RTO, description: "Out for Delivery" },
    RTO: { bucket: RTO, description: "Return to Origin (RTO)" },
    DTO: { bucket: RTO_DELIVERED, description: "Return Delivered" },
    Returned: { bucket: RTO, description: "Return Delivered" },
    LOST: { bucket: RTO, description: "Lost or Damaged" },
  };

  // Reverse Mapping
  const returnStatusMapping = {
    "In Transit": { bucket: RETURN_IN_TRANSIT, description: "In Transit (Return)" },
    Pending: { bucket: RETURN_ORDER_MANIFESTED, description: "Pending (Return)" },
    Dispatched: { bucket: RETURN_OUT_FOR_PICKUP, description: "Out for Pickup (Return)" },
    // "RTO": { bucket: 4, description: "Return to Origin (RTO)" },
    DTO: { bucket: RETURN_DELIVERED, description: "Return Delivered" },
    Returned: { bucket: RETURN_DELIVERED, description: "Return Delivered" },
  };

  const deliveredStatusMapping = {
    RTO: { bucket: RTO_DELIVERED, description: "RTO Delivered" },
    Delivered: { bucket: DELIVERED, description: "Delivered" },
    DTO: { bucket: RETURN_DELIVERED, description: "Delivered To Origin" },
    "RETURN Accepted": { bucket: RETURN_DELIVERED, description: "Delivered To Origin" },
    Returned: { bucket: RETURN_CONFIRMED, description: "Returned" },
  };

  const { ScanType: StatusType, Scan : Status } = scanDetail;

  // Determine the correct mapping based on StatusType (UD for forward, RT for return, DL for delivered)
  const statusMapping =
    StatusType === "UD"
      ? forwardStatusMapping
      : StatusType === "RT"
      ? rtoStatusMapping
      : StatusType === "PP"
      ? returnStatusMapping
      : StatusType === "DL"
      ? deliveredStatusMapping
      : null;

  return (
    (statusMapping && statusMapping[Status as keyof typeof statusMapping]) || {
      bucket: -1,
      description: "Status code not found",
    }
  );
}

export function getB2BShiprocketBucketing(status: string) {
  const shiprocketStatusMapping = {
    "Not Picked": { bucket: READY_TO_SHIP, description: "In Transit" },
    "In Transit": { bucket: IN_TRANSIT, description: "In Transit" },
    Pending: { bucket: IN_TRANSIT, description: "In Transit" },
    "Picked Up": { bucket: IN_TRANSIT, description: "In Transit" },
    "Out For Delivery": { bucket: IN_TRANSIT, description: "Out for Delivery" },
    "Reached At Destination": { bucket: DELIVERED, description: "Delivered" },
    Delivered: { bucket: DELIVERED, description: "Delivered" },
    RTO: { bucket: RTO, description: "Return to Origin (RTO)" },
    DTO: { bucket: RTO_DELIVERED, description: "Return Delivered" },
    Returned: { bucket: RETURN_CONFIRMED, description: "Return Delivered" },
    LOST: { bucket: LOST_DAMAGED, description: "Lost or Damaged" },
  };
  return (
    shiprocketStatusMapping[status as keyof typeof shiprocketStatusMapping] || {
      bucket: -1,
      description: "Status code not found",
    }
  );
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

export const generateAccessToken = async () => {
  try {
    const env = await EnvModel.findOne({ name: "ZOHO" }).lean();
    if (!env) return false;
    //@ts-ignore
    return env.token;
  } catch (err) {
    console.log(err, "err");
  }
};

// Old code
// export const calculateSellerInvoiceAmount = async () => {
//   try {
//     const sellers = await SellerModel.find({ _id: "663c76ad8e9e095def325208",
//       zoho_contact_id: { $exists: true }}).select("zoho_contact_id config _id name").lean();

//     const batchSize = 3;
//     const delay = 1;
//     // const delay = 5000;

//     const startOfMonth = new Date();
//     startOfMonth.setDate(1);
//     const today = new Date();
//     const threeMonthAgo = new Date();
//     threeMonthAgo.setMonth(today.getMonth() - 3);

//     const processBatch = async (batch: any[]) => {
//       for (const seller of batch) {
//         const sellerId = seller._id;
//         const zoho_contact_id = seller?.zoho_contact_id;

//         // If seller invoice already generated then skip it, handle calculation for lastMonth dispute
//         // case 1: zoho error, hit generate btn again then only generate invoice for them whose invoice is not generate for 3 month

//         // if comment this will lead to duplicate invoice generation for same month on zoho 
//         // const checkSellerInvoiceAlreadyGenerated = await InvoiceModel.findOne({
//         //   sellerId,
//         //   createdAt: { $gt: startOfMonth, $lte: today },
//         // });
//         // if (checkSellerInvoiceAlreadyGenerated) return;

//         const billedOrders: any = await ClientBillingModal.find({
//           sellerId,
//           billingDate: { $gt: startOfMonth, $lt: today },
//         })
//           .select("awb isDisputeRaised disputeId isRTOApplicable disputeRaisedBySystem")
//           .sort({ billingDate: -1 })
//           .populate("disputeId");

//         const allOrders = await B2COrderModel.find({
//           sellerId,
//           awb: { $in: billedOrders.map((item: any) => item.awb) },
//           // "orderStages.stageDateTime": { $gt: lastInvoiceDate, $lt: today }, // applying date filter
//         })
//           .select(["productId", "awb"])
//           .populate("productId");

//         const awbNotBilledDueToDispute = billedOrders
//           .filter(
//             (item: any) =>
//               (item.isDisputeRaised === true || item.disputeRaisedBySystem === true) && !item.disputeId?.accepted
//           )
//           .map((x: any) => x.awb);

//         const lastThreeMonthRecords = await NotInInvoiceAwbModel.find({
//           sellerId,
//           createdAt: { $gt: threeMonthAgo, $lt: today },
//         });
//         const notBilledAwb: any[] = [];

//         lastThreeMonthRecords.forEach((item) => {
//           notBilledAwb.push(...(item.notBilledAwb || []));
//         });

//         if (awbNotBilledDueToDispute.length > 0) {
//           // await NotInInvoiceAwbModel.updateOne(
//           //   { sellerId },
//           //   {
//           //     monthOf: format(startOfMonth, "MMM"),
//           //     notBilledAwb: awbNotBilledDueToDispute,
//           //     sellerId,
//           //   },
//           //   { upsert: true }
//           // );
//         }

//         const lastMonthDisputeAwbs = notBilledAwb || [];

//         let lastMonthAwbs = [];
//         if (lastMonthDisputeAwbs.length > 0) {
//           // @ts-ignore
//           lastMonthAwbs = (
//             await ClientBillingModal.find({ awb: { $in: lastMonthDisputeAwbs } }).populate("disputeId")
//             //@ts-ignore
//           ).filter((item) => item.disputeId?.accepted === true);
//         }

//         const orders = allOrders.filter((order: any) => !awbNotBilledDueToDispute.includes(order?.awb));

//         // Combine current and last month's AWBs
//         const awbToBeInvoiced = [...orders.map((order: any) => order.awb), ...lastMonthDisputeAwbs];

//         let totalAmount = 0;
//         const bills = await ClientBillingModal.find({ awb: { $in: awbToBeInvoiced } });
//         awbToBeInvoiced.forEach((awb) => {
//           const bill = bills.find((bill) => bill.awb === awb);
//           let forwardCharges = 0;
//           let rtoCharges = 0;
//           let codCharges = 0;
//           // let excessCharges = 0;
//           if (bill) {
//             if (bill.isRTOApplicable === false) {
//               codCharges = Number(bill.codValue);
//               forwardCharges = Number(bill.fwCharge);
//             } else {
//               rtoCharges = Number(bill.fwCharge);
//               forwardCharges = Number(bill.fwCharge);
//             }
//           }

//           totalAmount += forwardCharges + rtoCharges + codCharges;
//         });
//         totalAmount = Number(totalAmount.toFixed(2));
//         console.log(totalAmount, "totalAmount")

//         const invoiceAmount = totalAmount / 1.18;
//         console.log(invoiceAmount, "invoiceAmount")

//         const isPrepaid = seller.config?.isPrepaid;

//         if (invoiceAmount > 0) {
//           // if (isPrepaid) {
//           //   const spentAmount = Number((invoiceAmount * 1.18));
//           //   await updateSellerWalletBalance(sellerId.toString(), spentAmount, false, "Monthly Invoice Deduction");
//           // }
//           console.log(zoho_contact_id, seller.name, totalAmount, awbToBeInvoiced.length, isPrepaid, '\n')

//           // await createAdvanceAndInvoice(zoho_contact_id, totalAmount, awbToBeInvoiced, isPrepaid);
//         }
//       }
//     };

//     for (let i = 0; i < sellers.length; i += batchSize) {
//       const batch = sellers.slice(i, i + batchSize);
//       await processBatch(batch);

//       if (i + batchSize < sellers.length) {
//         console.log(`Waiting ${delay / 1000} seconds before processing the next batch...`);
//         await new Promise((resolve) => setTimeout(resolve, delay));
//       }
//     }

//     return { message: "All Invoice Generated Successfully", status: 200 };
//   } catch (err) {
//     console.log(err);
//     return { message: "Error: While generating Invoice", status: 500 };
//   }
// };

// New code with better performance reduce the number of queries

export const calculateSellerInvoiceAmount = async () => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const today = new Date();
    const threeMonthAgo = new Date();
    threeMonthAgo.setMonth(today.getMonth() - 3);
    
    const sellers = await SellerModel.find(
      { 
        zoho_contact_id: { $exists: true } 
      }
    ).select("zoho_contact_id config _id name").lean();

    const processSeller = async (seller: any) => {
      const sellerId = seller._id;
      
      // Check for already billed invoices
      // const existingInvoice = await InvoiceModel.findOne({
      //   sellerId,
      //   createdAt: { $gt: startOfMonth, $lte: today }
      // }).lean();
      
      // if (existingInvoice) {
      //   console.log(`Invoice already exists for seller ${seller.name}`);
      //   return {
      //     sellerId,
      //     status: 'skipped',
      //     reason: 'Invoice already exists'
      //   };
      // }
      
      const billingData = await ClientBillingModal.aggregate([
        {
          $facet: {
            currentBilling: [
              {
                $match: {
                  sellerId: sellerId,
                  billingDate: { $gt: startOfMonth, $lt: today }
                }
              },
              {
                $lookup: {
                  from: 'disputes',
                  localField: 'disputeId',
                  foreignField: '_id',
                  as: 'dispute'
                }
              },
              {
                $unwind: { path: '$dispute', preserveNullAndEmptyArrays: true }
              },
              {
                $lookup: {
                  from: 'invoices',
                  let: { awb: '$awb' },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $in: ['$$awb', { $ifNull: ['$billedAwbs', []] }] },
                            { $gt: ['$createdAt', threeMonthAgo] }
                          ]
                        }
                      }
                    }
                  ],
                  as: 'existingInvoices'
                }
              },
              {
                $match: {
                  existingInvoices: { $size: 0 }
                }
              }
            ],
            previousNotBilled: [{ $limit: 3 }]
          }
        },
        {
          $lookup: {
            from: 'notininvoiceawbs',
            pipeline: [
              {
                $match: {
                  sellerId: sellerId,
                  createdAt: { $gt: threeMonthAgo, $lt: today }
                }
              },
              {
                $project: {
                  _id: 0,
                  notBilledAwb: 1,
                  createdAt: 1
                }
              }
            ],
            as: 'previousNotBilled'
          }
        }
      ]);
      
      const currentBillingData = billingData[0]?.currentBilling || [];
      const previousNotBilledData = billingData[0]?.previousNotBilled.flatMap((item: any)=>item.notBilledAwb) || [];
      
      const awbNotBilledDueToDispute = currentBillingData
        .filter((item: any) => 
          (item.isDisputeRaised || item.disputeRaisedBySystem) && 
          !item.dispute?.accepted
        )
        .map((x: any) => x.awb);

      const validOrderAwbs = currentBillingData.map((item: any) => item.awb).filter(Boolean);
      
      const orderDetails = validOrderAwbs.length > 0 ? await B2COrderModel.aggregate([
        {
          $match: {
            sellerId: sellerId,
            awb: { $in: validOrderAwbs }
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product'
          }
        }
      ]) : [];

      if (awbNotBilledDueToDispute.length > 0) {
        await NotInInvoiceAwbModel.updateOne(
          { sellerId },
          {
            $set: {
              monthOf: format(startOfMonth, "MMM"),
              notBilledAwb: awbNotBilledDueToDispute,
              sellerId
            }
          },
          { upsert: true }
        );
      }

      const awbsToProcess = [
        ...orderDetails.filter(order => !awbNotBilledDueToDispute.includes(order.awb)).map(order => order.awb),
        ...previousNotBilledData
      ].filter(Boolean);

      const invoiceCalculation = awbsToProcess.length > 0 ? await ClientBillingModal.aggregate([
        {
          $match: {
            awb: { $in: awbsToProcess }
          }
        },
        {
          $addFields: {
            fwChargeNum: {
              $toDouble: { $ifNull: ["$fwCharge", 0] }
            },
            codValueNum: {
              $toDouble: { $ifNull: ["$codValue", 0] }
            }
          }
        },
        {
          $addFields: {
            forwardCharges: {
              $cond: {
                if: { $eq: ["$isRTOApplicable", false] },
                then: "$fwChargeNum",
                else: {
                  $cond: {
                    if: { $eq: ["$isRTOApplicable", true] },
                    then: "$fwChargeNum",
                    else: 0  // Fallback for any other value
                  }
                }
              }
            },
            rtoCharges: {
              $cond: [
                { $eq: ["$isRTOApplicable", true] },
                "$fwChargeNum",
                0
              ]
            },
            codCharges: {
              $cond: [
                { $eq: ["$isRTOApplicable", false] },
                "$codValueNum",
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalAmount: {
              $sum: { 
                $add: ["$forwardCharges", "$rtoCharges", "$codCharges"]
              }
            },
            awbCount: { $sum: 1 },
            awbs: { $push: "$awb" }
          }
        }
      ]) : [];

      const { totalAmount = 0, awbCount = 0, awbs = [] } = invoiceCalculation[0] || {};
      const roundedTotalAmount = Number(totalAmount.toFixed(2));
      const invoiceAmount = roundedTotalAmount / 1.18;

      if (invoiceAmount > 0) {
       await createAdvanceAndInvoice(seller.zoho_contact_id, totalAmount, awbs, seller.config?.isPrepaid);
      }

      return {
        sellerId,
        invoiceAmount,
        awbCount,
        totalAmount: roundedTotalAmount,
        awbs
      };
    };

    const batchSize = 3;
    const delay = 5000;
    const results = [];

    for (let i = 0; i < sellers.length; i += batchSize) {
      const batch = sellers.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processSeller));
      results.push(...batchResults);

      if (i + batchSize < sellers.length) {
        console.log(`Waiting ${delay/1000} seconds before processing next batch...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      message: "All Invoices Generated Successfully",
      status: 200,
      results
    };
  } catch (err: any) {
    console.error('Error in calculateSellerInvoiceAmount:', err);
    return { message: "Error: While generating Invoice", status: 500, error: err.message };
  }
};

export async function createAdvanceAndInvoice(
  zoho_contact_id: any,
  totalAmount: any,
  awbToBeInvoiced: any,
  isPrepaid: boolean
) {
  try {
    const accessToken = await generateAccessToken();
    if (!accessToken) return;

    const seller = await SellerModel.findOne({ zoho_contact_id });
    if (!seller) return;

    const date = new Date().toISOString().split("T")[0];
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoiceBody = {
      customer_id: zoho_contact_id,
      allow_partial_payments: true,
      date: date,
      due_date: dueDate.toISOString().split("T")[0],
      line_items: [
        {
          item_id: "852186000000016945",
          rate: totalAmount / 1.18,
          quantity: 1,
        },
      ],
    };
    const invoiceRes = await axios.post(
      `https://www.zohoapis.in/books/v3/invoices?organization_id=60014023368`,
      invoiceBody,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }
    );

    const invoiceId = invoiceRes.data.invoice.invoice_id;
    const invoice_number = invoiceRes.data.invoice.invoice_number;
    const invoiceTotalZoho = invoiceRes.data.invoice.total;

    if (isPrepaid) {
      const rechargeBody = {
        customer_id: zoho_contact_id,
        amount: invoiceTotalZoho,
      };
      const rechargeRes = await axios.post(
        `https://www.zohoapis.in/books/v3/customerpayments?organization_id=60014023368`,
        rechargeBody,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }
      );
      const paymentId = rechargeRes.data.payment.payment_id;
      const creditsBody = {
        invoice_payments: [
          {
            payment_id: paymentId,
            amount_applied: invoiceTotalZoho,
          },
        ],
      };
      const applyCredits = await axios.post(
        `https://www.zohoapis.in/books/v3/invoices/${invoiceId}/credits?organization_id=60014023368`,
        creditsBody,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }
      );
    }

    const invoicePdf = await axios.get(
      `https://www.zohoapis.in/books/v3/invoices/${invoiceId}?organization_id=60014023368&accept=pdf`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        responseType: "arraybuffer",
      }
    );

    const pdfBase64 = Buffer.from(invoicePdf.data, "binary").toString("base64");
    const invoice = await InvoiceModel.create({
      invoicedAwbs: awbToBeInvoiced,
      isPrepaidInvoice: seller.config?.isPrepaid,
      sellerId: seller._id,
      invoice_id: invoiceId,
      invoice_number: invoice_number,
      pdf: pdfBase64,
      date: invoiceRes.data.invoice.date,
      zohoAmt: invoiceTotalZoho,
      amount: totalAmount.toFixed(2),
    });

    seller.invoices.push(invoice._id);

    await seller.save();
    
    const emailTemplatePath = path.join(__dirname, '../email-template/invoice-template.html');
    const emailTemplate = fs.readFileSync(emailTemplatePath, 'utf8');

    const filledEmail = emailTemplate
          .replaceAll('{{invoiceId}}', invoice.invoice_number || '')
          .replaceAll('{{userName}}', seller.name || 'Seller')
          .replaceAll('{{invoiceAmt}}', formatCurrencyForIndia(Number(invoice.zohoAmt)) || '0')
          .replaceAll('{{invoiceDate}}', invoice.date || 'N/A');

    await emailService.sendEmailWithCSV(
        seller.email,
        `Invoice Generated: ${invoice.invoice_number}`,
        filledEmail,
        await generateListInoviceAwbs(invoice?.invoicedAwbs || [], invoice.invoice_number || ''),
        "Invoice AWBs",
        invoice.pdf ? Buffer.from(invoice.pdf, 'base64') : Buffer.alloc(0),
        "Invoice"
      );

    console.log("Completed for seller", seller.name);
  } catch (err) {
    console.log(err);
  }
}

interface ZohoInvoice {
  invoice_id: string;
  customer_id: string;
  status: string;
  balance: number;
}

interface DBInvoice {
  invoice_id: string;
  status: string;
  dueAmount: string;
}

export async function syncInvoices(invoices: { data: { invoices: ZohoInvoice[] } }, zohoId: string) {
  try {
    // Filter invoices for the specific seller
    const sellerInvoices = invoices.data.invoices.filter((invoice) => invoice.customer_id === zohoId);

    // Separate paid and unpaid invoices in a single pass
    const { paid, unpaid } = sellerInvoices.reduce(
      (acc, invoice) => {
        if (invoice.status === "paid") {
          acc.paid.push(invoice);
        } else {
          acc.unpaid.push(invoice);
        }
        return acc;
      },
      { paid: [] as ZohoInvoice[], unpaid: [] as ZohoInvoice[] }
    );

    // Create lookup maps for quick access
    const invoiceLookup = new Map(sellerInvoices.map((invoice) => [invoice.invoice_id, invoice]));

    // Fetch both paid and unpaid invoices concurrently
    const [paidInvoices, unpaidInvoices] = await Promise.all([
      InvoiceModel.find({
        invoice_id: { $in: paid.map((inv) => inv.invoice_id) },
      }),
      InvoiceModel.find({
        invoice_id: { $in: unpaid.map((inv) => inv.invoice_id) },
      }),
    ]);

    // Prepare bulk operations for both paid and unpaid invoices
    const bulkOps = [
      ...paidInvoices.map((invoice) => ({
        updateOne: {
          filter: { _id: invoice._id },
          update: {
            $set: {
              status: "paid",
              dueAmount: (invoiceLookup.get(invoice.invoice_id)?.balance || 0).toString(),
            },
          },
        },
      })),
      ...unpaidInvoices.map((invoice) => ({
        updateOne: {
          filter: { _id: invoice._id },
          update: {
            $set: {
              status: "unpaid",
              dueAmount: (invoiceLookup.get(invoice.invoice_id)?.balance || 0).toString(),
            },
          },
        },
      })),
    ];

    // Execute bulk update if there are operations to perform
    if (bulkOps.length > 0) {
      await InvoiceModel.bulkWrite(bulkOps);
    }

    // Return updated invoices
    const allInvoices = [...paidInvoices, ...unpaidInvoices];
    return { valid: true, invoices: allInvoices };
  } catch (error) {
    console.error("Error syncing invoices:", error);
    throw error;
  }
}

export async function addAllToZoho() {
  try {
    const access_token = await generateAccessToken();
    const sellers = await SellerModel.find({});
    sellers.forEach(async (seller) => {
      if (!seller.zoho_contact_id) {
        const creditsBody = {
          contact_name: seller.name,
        };
        const contact = await axios.post(
          `https://www.zohoapis.in/books/v3/contacts?organization_id=60014023368`,
          creditsBody,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Zoho-oauthtoken ${access_token}`,
            },
          }
        );
        seller.zoho_contact_id = contact.data.contact.contact_id;
        await seller.save();
        console.log("Seller added", seller.name, seller.zoho_contact_id);
      }
    });
  } catch (err) {
    console.log(err);
  }
}

//  =================           PDF EDIT            =====================
// const pdfUrl = 'https://api.rocketbox.in/api/common/download_file?code=https://ltl-prod-docs.s3.amazonaws.com/media/shipment_labels/gati/352515065.pdf:k0Bo8KqpYgHKwcbuk8DHtONBGlZaCERNf-Rlcy23G8o';
// const wordsToRemove = ['PICKRR', 'TECHNOLOGIES'];
// const replacementText = '';
// const outputFilePath = 'modified.pdf';

// modifyPdf(pdfUrl, wordsToRemove, replacementText, outputFilePath);

export async function modifyPdf(
  url: string,
  wordsToRemove: any,
  replacementText: any,
  outputFilePath: any,
  sellerId: string
) {
  try {
    const seller = await SellerModel.findById(sellerId).lean();
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const pdfData = response.data;

    const pdfDoc = await PDFDocument.load(pdfData);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    // Coordinates where the text to be replaced is located
    // You might need to manually find these coordinates for the text you want to replace
    const { width, height } = firstPage.getSize();

    firstPage.drawRectangle({
      x: 10,
      y: height - 64,
      width: 180,
      height: 10,
      color: rgb(1, 1, 1),
    });

    firstPage.drawRectangle({
      x: 10,
      y: height - 350,
      width: 180,
      height: 10,
      color: rgb(1, 1, 1),
    });

    firstPage.drawRectangle({
      x: 12,
      y: height - 636,
      width: 180,
      height: 10,
      color: rgb(1, 1, 1),
    });

    /////allcargo logo remove
    firstPage.drawRectangle({
      x: 221,
      y: height - 42,
      width: 95,
      height: 32,
      color: rgb(1, 1, 1),
    });
    firstPage.drawRectangle({
      x: 221,
      y: height - 327,
      width: 95,
      height: 30,
      color: rgb(1, 1, 1),
    });
    firstPage.drawRectangle({
      x: 218,
      y: height - 614,
      width: 104,
      height: 36,
      color: rgb(1, 1, 1),
    });

    //email and gst remove
    firstPage.drawRectangle({
      x: 10,
      y: height - 97,
      width: 180,
      height: 16,
      color: rgb(1, 1, 1),
    });

    firstPage.drawRectangle({
      x: 10,
      y: height - 382,
      width: 180,
      height: 15,
      color: rgb(1, 1, 1),
    });

    firstPage.drawRectangle({
      x: 12,
      y: height - 672,
      width: 180,
      height: 16,
      color: rgb(1, 1, 1),
    });

    //write gst, email
    firstPage.drawText(`Email: ${seller?.companyProfile?.companyEmail}, GST: ${seller?.gstInvoice?.gstin}`, {
      x: 10,
      y: height - 97,
      size: 7,
      color: rgb(0, 0, 0),
    });

    firstPage.drawText(`Email: ${seller?.companyProfile?.companyEmail}, GST: ${seller?.gstInvoice?.gstin}`, {
      x: 10,
      y: height - 382,
      size: 7,
      color: rgb(0, 0, 0),
    });
    firstPage.drawText(`Email: ${seller?.companyProfile?.companyEmail}, GST: ${seller?.gstInvoice?.gstin}`, {
      x: 10,
      y: height - 672,
      size: 7,
      color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();

    fs.writeFileSync(outputFilePath, pdfBytes);
    console.log(`PDF modified and saved to ${outputFilePath}`);
  } catch (err) {
    console.error("Error modifying the PDF:", err);
  }
}

export function handleDateFormat(dateTimeString: string) {
  const ddMmYyyyRegex = /^\d{2}-\d{2}-\d{4}/;

  let parsedDate;

  if (ddMmYyyyRegex.test(dateTimeString)) {
    parsedDate = parse(dateTimeString, "dd-MM-yyyy HH:mm:ss", new Date());
  } else {
    parsedDate = new Date(dateTimeString);
  }

  return formatISO(parsedDate);
}

export async function refundExtraInvoiceAmount() {
  try {
    const invoice = await InvoiceModel.find({});
    // const allAwbs = invoice.map((item) => item.invoicedAwbs).flat();
    const allAwbs = ["9145210470654", "627291701", "77628923993", "77648019245"];
    const bills = await ClientBillingModal.find({ awb: { $in: allAwbs } });
    // console.log(allAwbs.length, 'allAwbs');
    allAwbs.forEach(async (awb) => {
      const awbTransactions = await PaymentTransactionModal.find({ desc: { $regex: `AWB: ${awb}` } });
      const totalAmount = awbTransactions.reduce((acc, curr) => {
        if (curr.code === "DEBIT") {
          return acc + parseFloat(curr.amount);
        } else if (curr.code === "CREDIT") {
          return acc - parseFloat(curr.amount);
        }
        return acc;
      }, 0);
      const bill = bills.find((bill) => bill.awb === awb);
      let forwardCharges = 0;
      let rtoCharges = 0;
      let codCharges = 0;

      if (bill) {
        if (bill.isRTOApplicable === false) {
          codCharges = Number(bill.codValue);
          forwardCharges = Number(bill.rtoCharge);
        } else {
          rtoCharges = Number(bill.rtoCharge);
          forwardCharges = Number(bill.rtoCharge);
        }
      }
      const billTotal = forwardCharges + rtoCharges + codCharges;
      const refundAmount = billTotal - totalAmount;
      return { isRefund: billTotal < totalAmount, amt: refundAmount };
    });
  } catch (err) {
    console.log(err);
  }
}

// export async function reverseExtraRtoCodfor31() {
//   try {
//     const sellers = await SellerModel.find({email: 'smritia33@gmail.com'});

//     for (const seller of sellers) {
//       console.log(seller.name, 'seller');
      
//       const sellerId = seller._id;

//       const todayTransactions = await PaymentTransactionModal.find({
//         sellerId,
//         createdAt: { $gte: new Date("2025-01-31"), $lt: new Date("2025-02-01") },
//       });

//       const awbTransactions = todayTransactions.filter((item) =>
//         item.desc.includes("RTO-charges")
//       );

//       const awbs = awbTransactions.map((item) =>
//         item.desc.split(" ")[1].replace(",", "")
//       );

//       for (const awb of awbs) {
//         let details: Array<Array<number | string>> = [];

//         const paymentTransactionsRto = await PaymentTransactionModal.find({
//           desc: {
//             $in: [
//               `AWB: ${awb}, RTO-charges`,
//               `AWB: ${awb}, RTO-COD-charges`,
//               `${awb}, RTO charges`,
//               `AWB: ${awb}, RTO charges`,
//             ],
//           },
//         });

//         if (paymentTransactionsRto.length > 1) {
//           const transacToRevert = paymentTransactionsRto[1];
//           const refundAmount = parseFloat(transacToRevert.amount);
//           details.push([refundAmount, "rto"]);
//           console.log(seller.walletBalance, refundAmount, "rto");
          
//           seller.walletBalance += refundAmount;
//           await seller.save();
//           console.log(seller.walletBalance, "rto refunded");
          
//           await PaymentTransactionModal.findByIdAndDelete(transacToRevert._id);
//         }

//         const paymentTransactionsCod = await PaymentTransactionModal.find({
//           desc: {
//             $in: [
//               `AWB: ${awb}, COD-Refund`,
//               `${awb}, COD Refund`,
//               `AWB: ${awb}, COD Refund`,
//             ],
//           },
//         });

//         if (paymentTransactionsCod.length > 1) {
//           const transacToRevert = paymentTransactionsCod[1];
//           const excessAmount = parseFloat(transacToRevert.amount);
//           details.push([excessAmount, "cod"]);
//           console.log(seller.walletBalance, excessAmount, "cod");
          
//           seller.walletBalance -= excessAmount;
//           await seller.save();
//           console.log(seller.walletBalance, "cod took");
          
//           await PaymentTransactionModal.findByIdAndDelete(transacToRevert._id);
//         }

//         console.log(details, awb);
//       }
//     }
//   } catch (err) {
//     console.error("Error in reverseExtraRtoCodfor31:", err);
//   }
// }