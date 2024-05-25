import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import { isValidObjectId } from "mongoose";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { csvJSON } from "../utils";
import PincodeModel from "../models/pincode.model";
import CourierModel from "../models/courier.model";
import CustomPricingModel from "../models/custom_pricing.model";
import { nextFriday } from "date-fns";

export const getAllOrdersAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    let { limit, page, status }: { limit?: number; page?: number; status?: string } = req.query;

    const obj = {
      new: [NEW],
      "ready-to-ship": [READY_TO_SHIP],
      "in-transit": [IN_TRANSIT],
      delivered: [DELIVERED],
      ndr: [NDR],
      rto: [RTO],
    };

    limit = Number(limit);
    page = Number(page);
    page = page < 1 ? 1 : page;
    limit = limit < 1 ? 1 : limit;

    const skip = (page - 1) * limit;

    let orders, orderCount;
    try {
      let query: any = {};

      if (status && obj.hasOwnProperty(status)) {
        query.bucket = { $in: obj[status as keyof typeof obj] };
      }

      orders = await B2COrderModel.find(query)
        .sort({ createdAt: -1 })
        .populate("productId")
        .populate("pickupAddress")
        .lean();

      orderCount =
        status && obj.hasOwnProperty(status)
          ? await B2COrderModel.countDocuments(query)
          : await B2COrderModel.countDocuments({});
    } catch (err) {
      return next(err);
    }
    return res.status(200).send({
      valid: true,
      response: { orders, orderCount },
    });
  } catch (error) {
    return next(error);
  }
};

export const getSpecificOrderAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const orderId = req.params?.id;
  if (!isValidObjectId(orderId)) {
    return res.status(200).send({ valid: false, message: "Invalid orderId" });
  }
  //@ts-ignore
  const order = await B2COrderModel.findOne({ _id: orderId }).populate(["pickupAddress", "productId"]).lean();

  return !order
    ? res.status(200).send({ valid: false, message: "No such order found." })
    : res.status(200).send({ valid: true, order: order });
};

export const getSellerSpecificOrderAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const seller_id = req.params?.id;
  if (!isValidObjectId(seller_id)) {
    return res.status(200).send({ valid: false, message: "Invalid sellerId" });
  }
  const orders = await B2COrderModel.find({ sellerId: seller_id }).populate(["pickupAddress", "productId"]).lean();
  return !orders
    ? res.status(200).send({ valid: false, message: "No such order found." })
    : res.status(200).send({ valid: true, orders: orders });
};

export const getAllRemittances = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const remittanceOrders = await RemittanceModel.find({}).populate("sellerId").lean();
    if (!remittanceOrders) return res.status(200).send({ valid: false, message: "No Remittance found" });
    return res.status(200).send({
      valid: true,
      remittanceOrders,
    });
  } catch (error) {
    return res.status(200).send({ valid: false, message: "Error in fetching remittance" });
  }
};

export const getFutureRemittances = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const currentDate = new Date();
    const futureFriday = nextFriday(currentDate);

    const futureRemittances = await RemittanceModel.find({
      remittanceDate: { $gte: futureFriday },
    });
    return res.status(200).send({
      valid: true,
      remittanceOrders: futureRemittances,
    });
  } catch (error) {
    return res.status(200).send({ valid: false, message: "Error in fetching remittance" });
  }
};

export const getSellerRemittance = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, remittanceId } = req.query;
    console.log(sellerId, remittanceId, 'sellerId, remittanceId')

    if (!sellerId || !isValidObjectId(sellerId)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId" });
    }

    if (!remittanceId) {
      return res.status(400).send({ valid: false, message: "Invalid or missing remittanceId" });
    }

    const seller = await SellerModel.findById(sellerId);
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const remittance = await RemittanceModel.findOne({remittanceId, sellerId});
    if (!remittance) {
      return res.status(404).send({ valid: false, message: "Remittance not found" });
    }

    return res.status(200).send({
      valid: true,
      remittance,
    });

  } catch (err) {
    return next(err);
  }
}

export const updateSellerAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  let body = req.body;
  const new_id = req.query?.sellerId;
  if (body?.password) return res.status(200).send({ valid: false, message: "Invalid payload" });

  try {
    const updatedSeller = await SellerModel.findByIdAndUpdate(new_id, { ...body }, { new: true }).select([
      "-__v",
      "-password",
      "-margin",
    ]);

    return res.status(200).send({
      valid: true,
      message: "updated success",
      seller: updatedSeller,
    });
  } catch (err) {
    return next(err);
  }
};

export const getSellerDetails = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const seller_id = req.query?.sellerId;
    if (!isValidObjectId(seller_id)) {
      return res.status(200).send({ valid: false, message: "Invalid sellerId" });
    }
    const seller = await SellerModel.findById(seller_id).select(["-__v", "-password", "-margin"]).lean();
    return res.status(200).send({
      valid: true,
      seller,
    });
  } catch (err) {
    return next(err);
  }
};

export const uploadPincodes = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const fileData = req.file.buffer.toString();
    var data = fileData.replace(/,\s+/g, ",");
    const pincodes = csvJSON(data);
    console.log(pincodes, 'pincodes');

    const bulkOperations = pincodes.map(object => ({
      updateOne: {
        filter: { pincode: object.pincode },
        update: { $set: object },
        upsert: true
      }
    }));

    try {
      const result = await PincodeModel.bulkWrite(bulkOperations);

    } catch (err) {
      return next(err);
    }

    return res.status(200).json({
      valid: true,
      message: "File uploaded successfully",
    });
  } catch (err) {
    return next(err);
  }
};

export const getAllCouriers = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const couriers = await CourierModel.find().populate("vendor_channel_id").lean();
    if (!couriers) return res.status(200).send({ valid: false, message: "No Couriers found" })
    const courierWNickName = couriers.map((courier) => {

      const { vendor_channel_id, ...courierData } = courier;
      // @ts-ignore
      const nameWNickname = `${courierData.name} ${vendor_channel_id?.nickName}`;
      return {
        ...courierData,
        nameWNickname,
      };
    });
    return res.status(200).send({
      valid: true,
      couriers: courierWNickName,
    });
  } catch (err) {
    return next(err);
  }
}

export const getSellerCouriers = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.query?.sellerId as string;

    if (!sellerId || !isValidObjectId(sellerId)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId" });
    }

    const seller = await SellerModel.findById(sellerId).lean();
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const [couriers, customPricings] = await Promise.all([
      CourierModel.find({ _id: { $in: seller.vendors } }).populate("vendor_channel_id").lean(),
      CustomPricingModel.find({ sellerId })
        .populate({
          path: 'vendorId',
          populate: {
            path: 'vendor_channel_id'
          }
        })
        .lean(),
    ]);

    // @ts-ignore
    const customPricingMap = new Map(customPricings.map(courier => [courier.vendorId._id.toString(), courier]));

    const couriersWithNickname = couriers.map((courier) => {
      const customPricing = customPricingMap.get(courier._id.toString());
      // @ts-ignore
      const { vendor_channel_id, ...courierData } = customPricing || courier;
      // @ts-ignore
      const nameWithNickname = `${courierData?.name || courierData?.vendorId?.name} ${vendor_channel_id?.nickName || courierData?.vendorId?.vendor_channel_id?.nickName}`.trim();
      return {
        ...courierData,
        nameWithNickname,
      };
    });

    return res.status(200).send({
      valid: true,
      couriers: couriersWithNickname,
    });
  } catch (err) {
    return next(err);
  }
}

export const manageSellerCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, couriers } = req.body;
    if (!sellerId || !isValidObjectId(sellerId) || !couriers) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId or courierId" });
    }

    if (!Array.isArray(couriers)) {
      return res.status(400).send({ valid: false, message: "couriers should be an array" });
    }

    const seller = await SellerModel.findById(sellerId);
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    seller.vendors = couriers;
    await seller.save();

    return res.status(200).send({
      valid: true,
      message: "Courier managed successfully",
    });
  } catch (err) {
    return next(err);
  }
}