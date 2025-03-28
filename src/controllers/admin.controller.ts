import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import mongoose, { Types, isValidObjectId } from "mongoose";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { buildSearchQuery, calculateShippingCharges, convertToISO, csvJSON, generateListInoviceAwbs, getPaginationParams, updateSellerWalletBalance, validateB2BClientBillingFeilds, validateClientBillingFeilds, validateDisputeFeilds } from "../utils";
import PincodeModel from "../models/pincode.model";
import CourierModel from "../models/courier.model";
import CustomPricingModel, { CustomB2BPricingModel } from "../models/custom_pricing.model";
import ClientBillingModal from "../models/client.billing.modal";
import csvtojson from "csvtojson";
import exceljs from "exceljs";
import { endOfDay, format, formatDate, isValid, parse, startOfDay } from "date-fns";
import InvoiceModel from "../models/invoice.model";
import { calculateSellerInvoiceAmount, calculateZone, generateAccessToken } from "../utils/helpers";
import axios from "axios";
import B2BCalcModel from "../models/b2b.calc.model";
import { isValidPayload } from "../utils/helpers";
import PaymentTransactionModal from "../models/payment.transaction.modal";
import B2BClientBillingModal from "../models/b2b-client.billing.modal";
import { calculateRateAndPrice, regionToZoneMappingLowercase } from "../utils/B2B-helper";
import { MonthlyBilledAWBModel } from "../models/billed-awbs-month";
import { addDays } from 'date-fns';
import SellerDisputeModel from "../models/dispute.model";
import { paymentStatusInfo } from "../utils/recharge-wallet-info";
import ShipmenAwbCourierModel from "../models/shipment-awb-courier.model";

export const walletDeduction = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, amt, type, desc } = req.body;
    if (!sellerId || !amt || !desc) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }
    const seller = await SellerModel.findById(sellerId).select("_id walletBalance").lean();
    if (!seller) {
      return res.status(200).send({ valid: false, message: "Seller not found" });
    }
    const updatedSeller = await updateSellerWalletBalance(sellerId, Number(amt), type === "Credit", desc);
    return res.status(200).send({
      valid: true,
      message: "Wallet deduction successful",
      updatedSeller,
    });
  } catch (error) {
    return next(error);
  }
}

export const getAllOrdersAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    const { from, to, status, page = 1, limit = 10, statusFilter, search }: { search: string, statusFilter: string, from?: string, to?: string, status?: string, page?: number, limit?: number } = req.query;

    const statusBuckets = {
      new: [NEW],
      "ready-to-ship": [READY_TO_SHIP],
      "in-transit": [IN_TRANSIT],
      delivered: [DELIVERED],
      ndr: [NDR],
      rto: [RTO],
    };

    const query: any = {};

    if (status && statusBuckets.hasOwnProperty(status)) {
      query.bucket = { $in: statusBuckets[status as keyof typeof statusBuckets] };
    }

    if (from || to) {
      query.createdAt = {};
      if (from) {
        const [month, day, year] = from.split("/");
        query.createdAt.$gte = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      }
      if (to) {
        const [month, day, year] = to.split("/");
        query.createdAt.$lte = new Date(`${year}-${month}-${day}T23:59:59.999Z`);
      }
      if (!from) delete query.createdAt.$gte;
      if (!to) delete query.createdAt.$lte;
    }

    if (statusFilter) {
      const bucketStatusArray = statusFilter.split(',').filter(Boolean);
      if (bucketStatusArray.length > 0) {
        query.bucket = { $in: bucketStatusArray };
      }
    }

    if (search) {
      delete query.createdAt;
      query.$or = [
        { awb: { $regex: search, $options: 'i' } },
        { order_reference_id: { $regex: search, $options: 'i' } },
        { 'customerDetails.name': { $regex: search, $options: 'i' } },
        { 'customerDetails.phone': { $regex: search, $options: 'i' } }
      ];
    }
    const pageNum = Math.max(1, parseInt(page as any, 10));
    const limitNum = Math.max(1, parseInt(limit as any, 10));
    const skip = (pageNum - 1) * limitNum;

    const [orders, totalCount] = await Promise.all([
      B2COrderModel.find(query)
        .sort({ createdAt: -1 })
        .populate("productId")
        .populate("pickupAddress")
        .populate({ path: "sellerId", select: "name" })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .allowDiskUse(true),
      B2COrderModel.countDocuments(query)
    ]);

    return res.status(200).send({
      valid: true,
      response: {
        orders,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalCount / limitNum)
        }
      }
    });
  } catch (error) {
    return next(error);
  }
};


export const getAllUserWalletTransaction = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    let { from, to, status }: { from?: string, to?: string, status?: string } = req.query;

    const obj = {
      new: [NEW],
      "ready-to-ship": [READY_TO_SHIP],
      "in-transit": [IN_TRANSIT],
      delivered: [DELIVERED],
      ndr: [NDR],
      rto: [RTO],
    };

    let walletTxns
    try {
      let query: any = {};

      if (status && obj.hasOwnProperty(status)) {
        query.bucket = { $in: obj[status as keyof typeof obj] };
      }

      if (from || to) {
        query.createdAt = {};

        if (from) {
          const [month, day, year] = from.split("/");
          const fromDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
          query.createdAt.$gte = fromDate;
        }

        if (to) {
          const [month, day, year] = to.split("/");
          const toDate = new Date(`${year}-${month}-${day}T23:59:59.999Z`);
          query.createdAt.$lte = toDate;
        }

        if (!from) {
          delete query.createdAt.$gte;
        }
        if (!to) {
          delete query.createdAt.$lte;
        }
      }

      walletTxns = await PaymentTransactionModal.find(query)
        .sort({ createdAt: -1 })
        .populate({
          path: "sellerId",
          select: "name",
        });

    } catch (err) {
      return next(err);
    }

    return res.status(200).send({
      valid: true,
      response: { walletTxns },
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


export const getSellerRemittance = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, remittanceId } = req.query;

    if (!sellerId || !isValidObjectId(sellerId)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId" });
    }

    if (!remittanceId) {
      return res.status(400).send({ valid: false, message: "Invalid or missing remittanceId" });
    }

    const seller = await SellerModel.findById(sellerId).select("_id").lean();
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const remittance = await RemittanceModel.findOne({ remittanceId, sellerId });
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
  const sellerId = req.query?.sellerId;
  if (body?.password) return res.status(200).send({ valid: false, message: "Invalid payload" });

  try {
    const existingSeller = await SellerModel.findById(sellerId).select("-__v -password -margin");

    if (!existingSeller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    // Initialize an object to store the updated data
    const updatedData: any = {};

    // Update top-level fields
    for (const key in body) {
      if (body[key] !== undefined && body[key] !== null && key in existingSeller.toObject()) {
        updatedData[key] = body[key];
      }
    }

    // Handle nested objects like bankDetails and kycDetails
    if (body.bankDetails) {
      updatedData['bankDetails'] = { ...existingSeller.bankDetails, ...body.bankDetails };
    }

    if (body.kycDetails) {
      updatedData['kycDetails'] = { ...existingSeller.kycDetails, ...body.kycDetails };
    }

    // If there are no valid fields to update, return early
    if (Object.keys(updatedData).length === 0) {
      return res.status(400).send({ valid: false, message: "No valid fields to update" });
    }

    const updatedSeller = await SellerModel.findByIdAndUpdate(
      sellerId,
      { $set: updatedData },
      { new: true, select: "-__v -password -margin" }
    );

    if (body.isVerified === true) {
      try {
        const accessToken = await generateAccessToken();
        const updateContactBody = {
          "gst_no": updatedSeller?.gstInvoice?.gstin,
          "company_name": updatedSeller?.companyProfile?.companyName,
        }
        const updateRes = await axios.post(`https://www.zohoapis.in/books/v3/contacts/${updatedSeller?.zoho_contact_id}?organization_id=60014023368`, updateContactBody, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`
          }
        })
      } catch (error: any) {
        console.log(error?.message, 'error: [updateSellerAdmin]');
      }
    }

    return res.status(200).send({
      valid: true,
      message: "Updated successfully",
      seller: updatedSeller,
    });
  } catch (err) {
    console.log(err, 'err[updateselleradmin]')
    return next(err);
  }
};

export const updateSellerConfig = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { isD2C, isB2B, isPrepaid } = req.body;
    const { sellerId } = req.params;

    if (!sellerId) {
      return res.status(400).send({ error: "Seller ID is required" });
    }

    const update = {
      $set: {
        'config.isD2C': isD2C,
        'config.isB2B': isB2B,
        'config.isPrepaid': isPrepaid,
      }
    };

    const updatedSeller = await SellerModel.findByIdAndUpdate(sellerId, update, { new: true }).select("-__v -password -margin -kycDetails");

    if (!updatedSeller) {
      return res.status(404).send({ error: "Seller not found" });
    }

    res.status(200).send(updatedSeller);
  } catch (error) {
    next(error);
  }
}

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
    const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

    const pincodes = json.map((bill: any) => {
      return {
        Pincode: Number(bill["Pincode"]),
        StateName: bill["StateName"],
        District: bill["District"],
        City: bill["City"],
      };
    });

    const bulkOperations = pincodes.map(pincodeObj => ({
      updateMany: {
        filter: { Pincode: pincodeObj.Pincode },
        update: { $set: pincodeObj },
        upsert: true,
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
    const [couriers, b2bCouriers] = await Promise.all([
      CourierModel.find()
        .populate({
          path: 'vendor_channel_id',
          select: '-token -refreshToken'
        })
        .lean(),
      B2BCalcModel.find()
        .populate({
          path: 'vendor_channel_id',
          select: '-token -refreshToken'
        })
        .lean()
    ]);

    if (!couriers.length && !b2bCouriers.length) {
      return res.status(200).send({ valid: false, message: "No Couriers found" });
    }

    const mapWithNickname = (couriersList: any[]) => {
      return couriersList.map(courier => {
        const { vendor_channel_id, ...courierData } = courier;
        const nameWNickname = `${courierData.name} ${vendor_channel_id?.nickName || ''}`.trim();
        return {
          ...courierData,
          nameWNickname,
        };
      });
    };

    const [courierWNickName, b2bCouriersWNickName] = await Promise.all([
      mapWithNickname(couriers),
      mapWithNickname(b2bCouriers)
    ]);

    return res.status(200).send({
      valid: true,
      couriers: courierWNickName,
      b2bCouriers: b2bCouriersWNickName,
    });
  } catch (err) {
    return next(err);
  }
}

// B2C
export const getSellerCouriers = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.query?.sellerId! as string

    if (!sellerId || !isValidObjectId(sellerId)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId" });
    }

    const seller = await SellerModel.findById(sellerId).select('vendors').lean();
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const [couriers, customPricings] = await Promise.all([
      CourierModel.find({ _id: { $in: seller?.vendors } }).populate("vendor_channel_id").lean(),
      CustomPricingModel.find({ sellerId, vendorId: { $in: seller?.vendors } })
        .populate({
          path: 'vendorId',
          populate: {
            path: 'vendor_channel_id'
          }
        })
        .lean(),
    ]);

    // @ts-ignore
    const customPricingMap = new Map(customPricings.map(courier => [courier?.vendorId?._id.toString(), courier]));

    const couriersWithNickname = couriers.map((courier) => {
      const customPricing = customPricingMap.get(courier._id.toString());
      // @ts-ignore
      const { vendor_channel_id, ...courierData } = customPricing || courier;
      // @ts-ignore
      let nameWithNickname = `${courierData?.name || courierData?.vendorId?.name} ${vendor_channel_id?.nickName || courierData?.vendorId?.vendor_channel_id?.nickName}`.trim();
      if (customPricing) {
        // @ts-ignore
        courierData._id = courierData.vendorId?._id;
        nameWithNickname += " Custom";
      }

      return {
        ...courierData,
        nameWithNickname,
      };
    });

    return res.status(200).send({
      valid: true,
      couriers: couriersWithNickname,
    });
  } catch (err: any) {
    console.log(err?.message, 'err : {getSellerCouriers}')
    return next(err);
  }
}

// B2C
export const manageSellerCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, couriers } = req.body;

    // Validate input
    if (!sellerId || !isValidObjectId(sellerId) || !Array.isArray(couriers)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId or couriers" });
    }

    // Find seller and validate
    const seller = await SellerModel.findById(sellerId).select("-kycDetails");
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }


    const [validNewCouriers, validCustomCouriers] = await Promise.all([
      CourierModel.find({ _id: { $in: couriers } }).select("_id").lean(),
      CustomPricingModel.find({ sellerId, _id: { $in: couriers } }).select("_id").lean()
    ]);

    const validNewCourierIds = new Set(validNewCouriers.map(courier => courier._id.toString()));
    const validCustomCourierIds = new Set(validCustomCouriers.map(courier => courier._id.toString()));
    const mergedCourierIds = new Set([...validCustomCourierIds, ...validNewCourierIds]);

    seller.vendors = Array.from(mergedCourierIds).map(id => new Types.ObjectId(id));
    await seller.save();

    return res.status(200).send({
      valid: true,
      message: "Couriers managed successfully",
    });
  } catch (err: any) {
    console.log(err?.message, 'err : [manageSellerCourier]');

    return next(err);
  }
};

// B2B
export const getSellerB2BCouriers = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.query?.sellerId as string;

    if (!sellerId || !isValidObjectId(sellerId)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId" });
    }

    const seller = await SellerModel.findById(sellerId).select("b2bVendors").lean();
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const [couriers, customPricings] = await Promise.all([
      B2BCalcModel.find({ _id: { $in: seller?.b2bVendors || [] } }).populate("vendor_channel_id").lean(),
      CustomB2BPricingModel.find({ sellerId, B2BVendorId: { $in: seller?.b2bVendors || [] } })
        .populate({
          path: 'B2BVendorId',
          populate: {
            path: 'vendor_channel_id'
          }
        })
        .lean(),
    ]);

    // @ts-ignore
    const customPricingMap = new Map(customPricings.map(courier => [courier?.B2BVendorId?._id.toString(), courier]));

    const couriersWithNickname = couriers.map((courier) => {
      const customPricing = customPricingMap.get(courier._id.toString());
      // @ts-ignore
      const { vendor_channel_id, ...courierData } = customPricing || courier;
      // @ts-ignore
      let nameWithNickname = `${courierData?.name || courierData?.B2BVendorId?.name} ${vendor_channel_id?.nickName || courierData?.B2BVendorId?.vendor_channel_id?.nickName}`.trim();
      if (customPricing) {
        // @ts-ignore
        courierData._id = courierData.B2BVendorId?._id;
        nameWithNickname += " Custom";
      }

      return {
        ...courierData,
        nameWithNickname,
      };
    });

    return res.status(200).send({
      valid: true,
      couriers: couriersWithNickname,
    });
  } catch (err: any) {
    console.log(err?.message, 'err :{getSellerB2BCouriers}')
    return next(err);
  }
}

// B2B
export const manageB2BSellerCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, couriers } = req.body;

    // Validate input
    if (!sellerId || !isValidObjectId(sellerId) || !Array.isArray(couriers)) {
      return res.status(400).send({ valid: false, message: "Invalid or missing sellerId or couriers" });
    }

    // Find seller and validate
    const seller = await SellerModel.findById(sellerId).select("-kycDetails");
    if (!seller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }


    const [validNewCouriers, validCustomCouriers] = await Promise.all([
      B2BCalcModel.find({ _id: { $in: couriers } }).select("_id").lean(),
      CustomB2BPricingModel.find({ sellerId, _id: { $in: couriers } }).select("_id").lean()
    ]);

    const validNewCourierIds = new Set(validNewCouriers.map(courier => courier._id.toString()));
    const validCustomCourierIds = new Set(validCustomCouriers.map(courier => courier._id.toString()));
    const mergedCourierIds = new Set([...validCustomCourierIds, ...validNewCourierIds]);

    seller.b2bVendors = Array.from(mergedCourierIds).map(id => new Types.ObjectId(id));
    await seller.save();

    return res.status(200).send({
      valid: true,
      message: "Couriers managed successfully",
    });
  } catch (err: any) {
    console.log(err?.message, 'err [manageB2BSellerCourier]');

    return next(err);
  }
};

export const updateB2BVendor4Seller = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!isValidPayload(body, ["B2BVendorId", "sellerId"])) {
      return res.status(200).send({ valid: false, message: "Invalid payload." });
    }
    const { B2BVendorId, sellerId } = body;
    if (!isValidObjectId(B2BVendorId) || !isValidObjectId(sellerId)) {
      return res.status(200).send({ valid: false, message: "Invalid B2BVendorId or sellerId." });
    }
    try {
      const vendor = await B2BCalcModel.findById(B2BVendorId);
      if (!vendor) {
        const previouslySavedPricing = await CustomB2BPricingModel.findById(B2BVendorId).lean();
        if (previouslySavedPricing) {
          delete body.B2BVendorId;
          // const savedPricing = await CustomB2BPricingModel.findByIdAndUpdate(previouslySavedPricing._id, { ...body }, { new: true });

          let savedPricing = await CustomB2BPricingModel.findOne({ B2BVendorId: B2BVendorId, sellerId: sellerId });
          savedPricing = await CustomB2BPricingModel.findByIdAndUpdate(savedPricing?._id, { ...body }, { new: true });

          return res.status(200).send({ valid: true, message: "Vendor not found. Custom pricing updated for user", savedPricing });
        } else {
          const toAdd = {
            B2BVendorId: B2BVendorId,
            sellerId: sellerId,
            ...body,
          };
          const savedPricing = new CustomB2BPricingModel(toAdd);
          await savedPricing.save();
          return res.status(200).send({ valid: true, message: "Vendor not found. Custom pricing created for user", savedPricing });
        }
      } else {
        // Vendor found, update its pricing
        delete body?.B2BVendorId;
        delete body?.sellerId;
        const previouslySavedPricing = await CustomB2BPricingModel.findOne({ sellerId, B2BVendorId }).lean();
        let savedPricing;
        if (previouslySavedPricing) {
          // Update custom pricing
          savedPricing = await CustomB2BPricingModel.findByIdAndUpdate(previouslySavedPricing._id, { ...body }, { new: true });
          return res.status(200).send({ valid: true, message: "Vendor priced updated for user", savedPricing });
        } else {
          const toAdd = {
            B2BVendorId: B2BVendorId,
            sellerId: sellerId,
            // TODO: Add other fields

            ...body,
          };

          savedPricing = new CustomB2BPricingModel(toAdd);
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
    return next(error)
  }
};

export const uploadDisputeCSV = async (req: ExtendedRequest, res: Response) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).send({ valid: false, message: "No file uploaded" });
  }

  const alreadyExistingBills = await ClientBillingModal.find({}).select(["orderRefId", "awb", "rtoAwb"]);
  const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

  const csvdisputes = json.map((order: any) => {
    return {
      awb: (order["AWB"])?.toString(),
      clientWeight: Number(order["Client Weight"] || 0),
      chargedWeight: Number(order["Charged Weight"]),
      isAccept: Boolean(order["Accept/Reject"]?.toLowerCase() === "accept")
    };
  });

  const disputes = csvdisputes.filter((order: any) => !!order.awb);

  if (disputes.length < 1) {
    return res.status(200).send({ valid: false, message: "empty payload" });
  }

  try {
    const errorWorkbook = new exceljs.Workbook();
    const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

    errorWorksheet.columns = [
      { header: 'Awb', key: 'awb', width: 20 },
      { header: 'Error Message', key: 'errors', width: 40 },
    ];

    const errorRows: any = [];

    // Validate each order and collect errors for invalid fields
    disputes.forEach((order) => {
      const errors: string[] = [];
      Object.entries(order).forEach(([fieldName, value]) => {
        const error = validateDisputeFeilds(value, fieldName, order, alreadyExistingBills);
        if (error) {
          errors.push(error);
        }
      });

      if (errors.length > 0) {
        errorRows.push({ awb: order.awb, errors: errors.join(", ") });
      }
    });

    const orderAwbs = disputes.map(order => order.awb);
    const orders = await B2COrderModel.find({
      $or: [{ awb: { $in: orderAwbs } }],
    }).populate(["productId", "pickupAddress"]);

    const updatedDispute = await Promise.all(disputes.map(async (dispute) => {
      if (!dispute.isAccept) return {}

      const order: any = orders.find(o => o.awb === dispute.awb);
      if (!order) {
        throw new Error(`Order not found for AWB: ${dispute.awb}`);
      }

      const bill = await ClientBillingModal.findOne({ awb: dispute.awb });

      if (!bill) {
        throw new Error("Billing Not Found!")
      }

      let vendor: any = await CustomPricingModel.findOne({
        sellerId: order.sellerId,
        vendorId: order.carrierId || bill.carrierID
      }).populate({
        path: 'vendorId',
        populate: {
          path: 'vendor_channel_id'
        }
      });

      if (!vendor) {
        vendor = await CourierModel.findById(order.carrierId || bill.carrierID).populate("vendor_channel_id");
      }

      const csvBody = {
        weight: dispute.chargedWeight,
        paymentType: bill.shipmentType,
        collectableAmount: Math.max(0, order.amount2Collect),
      };

      const { totalCharge, codCharge, fwCharge } = await calculateShippingCharges(bill.zone, csvBody, vendor, await calculateZone(order.pickupAddress.pincode, order.customerDetails.get("pincode")), dispute.chargedWeight); // csv calc 

      let fwExcessCharge: any = bill.fwExcessCharge;
      if (Number(fwCharge) > Number(bill.rtoCharge)) {
        fwExcessCharge = (fwCharge - Number(bill.rtoCharge)).toFixed(2)
      }

      const rtoCharge = (totalCharge - (codCharge || 0)).toFixed(2)

      const billingAmount = bill.isRTOApplicable ? Math.max(0, ((totalCharge - order.shipmentCharges) + Number(rtoCharge))).toFixed(2) : (Math.max(0, totalCharge - order.shipmentCharges)).toFixed(2);

      await Promise.all([
        bill.updateOne({
          codValue: codCharge,
          fwExcessCharge,
          rtoCharge,
          orderWeight: order.orderWeight,
          billingAmount: billingAmount, // fw+RTO without COD Charge
          chargedWeight: dispute.chargedWeight,
        }),

        MonthlyBilledAWBModel.findOneAndUpdate(
          { sellerId: order.sellerId, awb: order.awb },
          {
            billingAmount: billingAmount,
            chargedWeight: dispute.chargedWeight,
          },
          {
            new: true,
            setDefaultsOnInsert: true,
            upsert: true,
          }
        ),
      ]);

      return {
        updateOne: {
          filter: { awb: bill.awb },
          update: {
            $set: {
              accepted: true
            }
          },
          upsert: true
        }
      };
    }));

    const validDispute = updatedDispute.filter(x => !!x)
    // @ts-ignore
    await SellerDisputeModel.bulkWrite(validDispute);

    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');
      await errorWorkbook.csv.write(res);
      return res.end();
    }

    return res.status(200).send({ valid: true, message: "Dispute data uploaded successfully" });
  } catch (error) {
    console.error("Error in uploadDisputeCSV:", error);
    return res.status(500).send({ valid: false, message: "An error occurred while processing the request" });
  }
}

export const REQUIRED_CSV_HEADERS = [
  "Awb",
  // "COD Value",
  "Shipment Type",
  "Charged Weight",
  "Zone",
  "Carrier ID",
  "Forward Applicable",
  "RTO Applicable"
];


export const uploadClientBillingCSV = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  if (!req.file?.buffer) {
    return res.status(400).send({ valid: false, message: "No file uploaded" });
  }

  try {
    const errorWorkbook = new exceljs.Workbook();
    const errorWorksheet = initializeErrorWorksheet(errorWorkbook);
    const errorRows: any = [];

    const csvString = req.file.buffer.toString('utf8');
    const firstLine = csvString.split('\n')[0];
    const headers = firstLine.split(',').map(header => header.trim());

    const missingHeaders = REQUIRED_CSV_HEADERS.filter(
      requiredHeader => !headers.some(h => h === requiredHeader)
    );

    if (missingHeaders.length > 0) {
      errorRows.push({
        awb: 'HEADER_VALIDATION_ERROR',
        errors: `Missing required headers: ${missingHeaders.join(', ')}`
      });
      return sendErrorReport(res, errorWorksheet, errorRows);
    }

    const json = await csvtojson().fromString(csvString);
    const bills = json.map(parseBillFromCSV).filter((bill: any) => !!bill.awb);

    if (bills.length < 1) {
      errorRows.push({
        awb: 'EMPTY_PAYLOAD',
        errors: 'No valid records found in the CSV'
      });
      return sendErrorReport(res, errorWorksheet, errorRows);
    }

    const orderAwbs = bills.map(bill => bill.awb);
    const orders = await B2COrderModel.find({
      $or: [{ awb: { $in: orderAwbs } }],
    }).populate(["productId", "pickupAddress"]);

    // Collect missing AWBs
    bills.forEach(bill => {
      if (!orders.find(o => o.awb === bill.awb)) {
        errorRows.push({ awb: bill.awb, errors: "AWB not found in the database" });
      }
    });

    // Process valid bills
    const walletUpdates: Array<{
      sellerId: string;
      amount: number;
      isCredit: boolean;
      description: string;
    }> = [];

    const billsWithCharges = await Promise.all(
      bills.map(async bill => {
        const order = orders.find(o => o.awb === bill.awb);
        if (!order || !order.pickupAddress) return null;

        // const vendor = await getVendorInfo(order.sellerId.toString(), order.carrierId ?? bill.carrierID);
        if (!order.awb) {
          throw new Error(`AWB is missing for order: ${order._id}`);
        }

        const vendor = await getVendorInfo(order.awb, order.sellerId.toString(), order.carrierId ?? bill.carrierID);
        if (!vendor) return null;

        // @ts-ignore
        const orderZone = await calculateZone(order.pickupAddress.get("pincode"), order.customerDetails.get("pincode"));

        const { charges, incrementPrice } = await processCharges(bill, order, vendor, orderZone);

        const paymentTransactions = await PaymentTransactionModal.find({
          desc: {
            $in: [
              `${bill.awb}, RTO charges`,
              `${bill.awb}, RTO COD charges`
            ]
          }
        });

        const isRTOApplicable = order.bucket === 5 || bill.isRTOApplicable;
        const isRtoChargeDeducted = paymentTransactions.some(pt =>
          pt.desc.includes("RTO charges")
        );
        const isRtoCODRefund = paymentTransactions.some(pt =>
          pt.desc.includes("RTO COD charges")
        );

        if (charges.zoneChangeCharge > 0) {
          walletUpdates.push({
            sellerId: order.sellerId.toString(),
            amount: charges.zoneChangeCharge,
            isCredit: false,
            description: `AWB: ${order.awb}, Zone Change Charge ${orderZone} --> ${bill.zone}`
          });
        }

        if (isRTOApplicable) {
          if (!isRtoChargeDeducted && charges.fwCharge > 0) {
            walletUpdates.push({
              sellerId: order.sellerId.toString(),
              amount: charges.fwCharge,
              isCredit: false,
              description: `AWB: ${bill.awb}, ~RTO charges`
            });
          }

          if (!isRtoCODRefund && order.payment_mode === 1 && charges.codCharge > 0) {
            walletUpdates.push({
              sellerId: order.sellerId.toString(),
              amount: charges.codCharge,
              isCredit: true,
              description: `AWB: ${bill.awb}, ~RTO COD charges`
            });
          }
        }

        return createBillingUpdateOperation(bill, order, vendor, charges, incrementPrice, orderZone);
      })
    );

    const validBills = billsWithCharges.filter(Boolean);

    // Perform all updates in a transaction
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      // await ClientBillingModal.bulkWrite(validBills.filter(bill => bill !== null), { session });
      // @ts-ignore
      const result = await ClientBillingModal.bulkWrite(validBills);

      // Execute all wallet updates
      for (const update of walletUpdates) {
        await updateSellerWalletBalance(
          update.sellerId,
          update.amount,
          update.isCredit,
          update.description,
        );
      }
    });
    await session.endSession();

    if (errorRows.length > 0) {
      return sendErrorReport(res, errorWorksheet, errorRows);
    }

    return res.status(200).send({ valid: true, message: "Billing data uploaded successfully" });
  } catch (error) {
    console.error("Error in uploadClientBillingCSV:", error);
    return res.status(500).send({ valid: false, message: `An error occurred while processing the request: ${error}` });
  }
};

// Helper functions for uploadClientBillingCSV -------------------------
const parseBillFromCSV = (bill: any) => ({
  awb: bill["Awb"]?.toString(),
  codValue: Number(bill["COD Value"] || 0),
  shipmentType: bill["Shipment Type"].toUpperCase() === "COD" ? 1 : 0,
  chargedWeight: Number(bill["Charged Weight"]),
  zone: bill["Zone"],
  carrierID: bill["Carrier ID"],
  isForwardApplicable: Boolean(bill["Forward Applicable"]?.toUpperCase() === "TRUE"),
  isRTOApplicable: Boolean(bill["RTO Applicable"]?.toUpperCase() === "TRUE"),
});

const initializeErrorWorksheet = (workbook: any) => {
  const worksheet = workbook.addWorksheet('Error Sheet');
  worksheet.columns = [
    { header: 'Awb', key: 'awb', width: 20 },
    { header: 'Error Message', key: 'errors', width: 40 },
  ];
  return worksheet;
};

const getVendorInfo = async (awb: string, sellerId: string, carrierId: string) => {
  let vendor = null;
  vendor = await ShipmenAwbCourierModel.findOne({ awb: awb }).populate("vendor_channel_id");

  if (!vendor) {
    vendor = await CustomPricingModel.findOne({
      sellerId,
      vendorId: carrierId
    }).populate({
      path: 'vendorId',
      populate: {
        path: 'vendor_channel_id'
      }
    });

    if (!vendor) {
      vendor = await CourierModel.findById(carrierId).populate("vendor_channel_id");
    }
  }

  return vendor;
};

const processCharges = async (bill: any, order: any, vendor: any, orderZone: string) => {
  const weightSlab = vendor?.weightSlab || vendor?.vendorId?.weightSlab;
  const csvBody = {
    weight: Math.max(bill.chargedWeight, weightSlab),
    paymentType: bill.shipmentType,
    collectableAmount: Math.max(0, order.amount2Collect),
  };

  const { incrementPrice, totalCharge, codCharge, fwCharge, weightDiffCharge, zoneChangeCharge } = await calculateShippingCharges(
    bill.zone,
    csvBody,
    vendor,
    orderZone,
    Math.max(order.orderWeight, weightSlab),
  );

  return {
    charges: { totalCharge, codCharge, fwCharge, weightDiffCharge, zoneChangeCharge },
    incrementPrice
  };
};

const createBillingUpdateOperation = (bill: any, order: any, vendor: any, charges: any, incrementPrice: any, orderZone: string) => ({
  updateOne: {
    filter: { awb: bill.awb },
    update: {
      $set: {
        ...bill,
        sellerId: order.sellerId,
        basePrice: incrementPrice.basePrice,
        baseWeight: (vendor?.weightSlab || vendor?.vendorId?.weightSlab || 0).toString(),
        incrementPrice: incrementPrice.incrementPrice,
        orderRefId: order.order_reference_id,
        orderCharges: order.shipmentCharges,
        orderWeight: order.orderWeight,
        codValue: charges.codCharge,
        rtoAwb: "",
        rtoCharge: bill.isRTOApplicable ? charges.fwCharge : 0,
        orderZone,
        newZone: bill.zone,
        billingAmount: bill.isRTOApplicable ?
          Math.max(0, ((charges.totalCharge - order.shipmentCharges) + Number(charges.rtoCharge))).toFixed(2) :
          Math.max(0, charges.totalCharge - order.shipmentCharges).toFixed(2),
        billingDate: format(new Date(), 'yyyy-MM-dd'),
        vendorWNickName: `${vendor?.name || vendor?.vendorId?.name} ${vendor?.vendor_channel_id?.nickName || vendor?.vendorId?.vendor_channel_id.nickName}`.trim(),
        paymentStatus: paymentStatusInfo.NOT_PAID,
        recipientName: order.customerDetails.get("name"),
        fromCity: order?.pickupAddress?.city || order?.pickupAddress?.get("city"),
        toCity: order.customerDetails.get("city"),

        fwExcessCharge: charges.weightDiffCharge,
        rtoExcessCharge: charges.weightDiffCharge > 0 && bill.isRTOApplicable ? charges.weightDiffCharge : 0,
        fwCharge: charges.fwCharge,
        zoneChangeCharge: charges.zoneChangeCharge,
        disputeRaisedBySystem: charges.weightDiffCharge > 0
      }
    },
    upsert: true
  }
});

const sendErrorReport = async (res: Response, worksheet: any, errorRows: any[]) => {
  // Add rows to the worksheet
  worksheet.addRows(errorRows);

  // Set CSV response headers
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

  // Create a CSV buffer
  const csvBuffer = await worksheet.workbook.csv.writeBuffer();

  // Send the buffer
  res.send(csvBuffer);
};
// Helper functions End for uploadClientBillingCSV -------------------------

export const uploadB2BClientBillingCSV = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).send({ valid: false, message: "No file uploaded" });
  }

  const alreadyExistingBills = await B2BClientBillingModal.find({}).select(["orderRefId", "awb"]);
  const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

  const bills = json.map((bill: any) => {
    const isODAApplicable = Boolean(bill["ODA Applicable"]?.toUpperCase() === "YES");
    return {
      awb: bill["AWB"],
      orderWeight: bill["Weight (Kgs)"],
      otherCharges: bill["Other Charges"],
      carrierID: bill["Carrier Id"],
      isODAApplicable,
    };
  });

  if (bills.length < 1) {
    return res.status(200).send({ valid: false, message: "empty payload" });
  }

  try {
    const errorWorkbook = new exceljs.Workbook();
    const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

    errorWorksheet.columns = [
      { header: 'Awb', key: 'awb', width: 20 },
      { header: 'Error Message', key: 'errors', width: 40 },
    ];

    const errorRows: any = [];

    bills.forEach((bill) => {
      const errors: string[] = [];
      Object.entries(bill).forEach(([fieldName, value]) => {
        const error = validateB2BClientBillingFeilds(value, fieldName, bill, alreadyExistingBills);
        if (error) {
          errors.push(error);
        }
      });

      if (errors.length > 0) {
        errorRows.push({ awb: bill.awb, errors: errors.join(", ") });
      }
    });

    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

      await errorWorkbook.csv.write(res);
      return res.end();
    }

    const orderAwbs = bills.map(bill => bill.awb);
    const orders = await B2BOrderModel.find({
      $or: [
        { awb: { $in: orderAwbs } },
      ]
    }).populate(["pickupAddress", "customer"]);

    const orderRefIdToSellerIdMap = new Map();
    orders.forEach(order => {
      orderRefIdToSellerIdMap.set(order.order_reference_id, order.sellerId);
    });

    const billsWithCharges = await Promise.all(bills?.map(async (bill) => {
      const order: any = orders.find(o => o.awb === bill.awb);
      if (!order) {
        throw new Error(`Order not found for AWB: ${bill.awb}`);
      }

      const courier: any = await B2BCalcModel.findById(bill.carrierID).populate("vendor_channel_id");

      const pickupPincodeData = await PincodeModel.findOne({ Pincode: order.pickupAddress.pincode }).exec();
      const deliveryPincodeData = await PincodeModel.findOne({ Pincode: order.customer.pincode }).exec();

      if (!pickupPincodeData || !deliveryPincodeData) {
        return;
      }

      const fromRegionName = pickupPincodeData.District.toLowerCase(); // convert to lowercase
      const toRegionName = deliveryPincodeData.District.toLowerCase(); // convert to lowercase

      const Fzone = await regionToZoneMappingLowercase(fromRegionName);
      const Tzone = await regionToZoneMappingLowercase(toRegionName);

      if (!Fzone || !Tzone) {
        return res.status(400).send({
          valid: false,
          message: "Zone not found for the given region",
        });
      }

      const result = await calculateRateAndPrice(courier, Fzone, Tzone, bill.orderWeight, courier?._id?.toString(), fromRegionName, toRegionName, order.amount, bill.otherCharges, bill.isODAApplicable);

      const futureDate = addDays(new Date(), 7);

      return {
        updateOne: {
          filter: { awb: bill.awb },
          update: {
            $set: {
              sellerId: order.sellerId,
              orderRefId: order.order_reference_id,
              awb: bill.awb,
              isODAApplicable: bill.isODAApplicable,
              orderWeight: bill.orderWeight,
              billingDate: futureDate.toISOString(),
              billingAmount: result.finalAmount,
              otherCharges: result.otherExpensesTotal,
              vendorWNickName: `${courier.name} ${courier.vendor_channel_id.nickName}`,
            }
          },
          upsert: true
        }
      };
    }));

    // @ts-ignore
    // await B2BClientBillingModal.bulkWrite(billsWithCharges);

    // Schedule wallet balance deduction after 7 days
    setTimeout(async () => {
      await Promise.all(billsWithCharges.map(async (bill: any) => {
        if (bill.sellerId && bill.billingAmount) {
          await updateSellerWalletBalance(bill.sellerId, (bill.billingAmount), false, `AWB: ${bill.awb}, Revised B2B`);
        }
      }));
    }, 7 * 24 * 60 * 60 * 1000);

    return res.status(200).send({
      valid: true,
      message: "Billing uploaded successfully",
    });
  } catch (error) {
    console.error(error);
    return next(error);
  }
};


export const getVendorBillingData = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const [data, b2bData] = await Promise.all([
      ClientBillingModal.find({})
        .populate({
          path: 'sellerId',
          select: '-kycDetails'
        }),
      B2BClientBillingModal.find({})
        .populate({
          path: 'sellerId',
          select: '-kycDetails'
        })
    ]);

    if (!data.length && !b2bData.length) {
      return res.status(200).send({ valid: false, message: "No Client Billing found" });
    }

    return res.status(200).send({
      valid: true,
      data: data.reverse(),
      b2bData: b2bData.reverse()
    });
  } catch (error) {
    return next(error);
  }
}

export const getClientBillingData = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, skip } = getPaginationParams(req);
    const searchTerm = req.query.search as string;
    const sortField = req.query.sortField as string || "billingDate";
    const sortOrder = parseInt(req.query.sortOrder as string) || -1;

    // Build search query
    const searchQuery = searchTerm ? buildSearchQuery(searchTerm, ["awb", "orderRefId", "recipientName"]) : {};

    // Date range filter
    const dateFilter: any = {};
    if (req.query.from || req.query.to) {
      dateFilter["billingDate"] = {};

      if (req.query.from) {
        const fromDate = parse(req.query.from as string, "MM/dd/yyyy", new Date());
        if (isValid(fromDate)) {
          dateFilter["billingDate"]["$gte"] = startOfDay(fromDate);
        } else {
          console.warn(`Invalid 'from' date provided: ${req.query.from}`);
        }
      }

      if (req.query.to) {
        const toDate = parse(req.query.to as string, "MM/dd/yyyy", new Date());
        if (isValid(toDate)) {
          dateFilter["billingDate"]["$lte"] = endOfDay(toDate);
        } else {
          console.warn(`Invalid 'to' date provided: ${req.query.to}`);
        }
      }
    }

    // Combine search query and date filter
    const query = { ...searchQuery, ...dateFilter };

    // Get total count for pagination
    const [totalD2C, totalB2B] = await Promise.all([
      ClientBillingModal.countDocuments(query),
      B2BClientBillingModal.countDocuments(query),
    ]);

    // Get data with pagination
    const [data, b2bData] = await Promise.all([
      ClientBillingModal.find(query)
        .populate({
          path: "sellerId",
          select: "name",
        })
        .sort({ billingDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      B2BClientBillingModal.find(query)
        .populate({
          path: "sellerId",
          select: "name",
        })
        .sort({ billingDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    if (!data.length && !b2bData.length) {
      return res.status(200).send({
        valid: false,
        message: "No Client Billing found",
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0,
        },
      });
    }

    // Get billing status more efficiently
    const billedAwbs = data.map((bill) => bill.awb);
    const billsStatus = await MonthlyBilledAWBModel.find(
      { awb: { $in: billedAwbs } },
      { awb: 1, isRTOApplicable: 1 }
    ).lean();

    // Create a map for faster lookup
    const statusMap: Record<string, string> = billsStatus.reduce((map, status: any) => {
      map[status.awb] = status.isRTOApplicable ? "Forward + RTO Billed" : "Forward Billed";
      return map;
    }, {} as Record<string, string>);

    // Attach status without iteration
    const billsWStatus = data.map((bill: any) => ({
      ...bill,
      status: statusMap[bill.awb] || "Forward Billed",
    }));

    return res.status(200).send({
      valid: true,
      data: billsWStatus,
      b2bData: b2bData,
      pagination: {
        total: totalD2C + totalB2B,
        page,
        limit,
        pages: Math.ceil((totalD2C + totalB2B) / limit),
      },
    });
  } catch (error) {
    console.error("Error in getClientBillingData:", error);
    return next(error);
  }
};

export const getAllRemittances = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, skip } = getPaginationParams(req);
    const searchTerm = req.query.search as string;
    const sortField = req.query.sortField as string || "remittanceDate";
    const sortOrder = parseInt(req.query.sortOrder as string) || -1;

    const query: any = {};

    if (req.query.from || req.query.to) {
      query.remittanceDate = {};

      if (req.query.from) {
        const parsedFrom = parse(req.query.from as string, "MM/dd/yyyy", new Date());
        if (isValid(parsedFrom)) {
          query.remittanceDate.$gte = format(parsedFrom, "yyyy-MM-dd");
        }
      }

      if (req.query.to) {
        const parsedTo = parse(req.query.to as string, "MM/dd/yyyy", new Date());
        if (isValid(parsedTo)) {
          query.remittanceDate.$lte = format(parsedTo, "yyyy-MM-dd");
        }
      }
    }

    if (searchTerm) {
      query.$or = [
        { remittanceId: { $regex: searchTerm, $options: "i" } },
        { BankTransactionId: { $regex: searchTerm, $options: "i" } },
        { "orders.awb": { $regex: searchTerm, $options: "i" } },
      ];
    }

    if (req.query.status) query.remittanceStatus = req.query.status;
    if (req.query.sellerId) query.sellerId = req.query.sellerId;

    const total = await RemittanceModel.countDocuments(query);

    const sortOptions: any = {};
    sortOptions[sortField] = sortOrder;

    const remittanceOrders = await RemittanceModel.find(query, {
      BankTransactionId: 1,
      remittanceStatus: 1,
      remittanceDate: 1,
      remittanceId: 1,
      remittanceAmount: 1,
      sellerId: 1,
      orders: {
        $map: {
          input: "$orders",
          as: "order",
          in: {
            orderStages: "$$order.orderStages",
            awb: "$$order.awb",
          },
        },
      },
    })
      .populate({ path: "sellerId", select: "name" })
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    if (!remittanceOrders.length) {
      return res.status(200).send({
        valid: false,
        message: "No Remittance found",
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0,
        },
      });
    }

    return res.status(200).send({
      valid: true,
      remittanceOrders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error in getAllRemittances:", error);
    return res.status(500).send({ valid: false, message: "Error in fetching remittance" });
  }
};

export const getFutureRemittances = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, skip } = getPaginationParams(req);
    const searchTerm = req.query.search as string;
    const sortField = req.query.sortField as string || 'remittanceDate';
    const sortOrder = parseInt(req.query.sortOrder as string) || -1;

    const currentDate = new Date();
    const currDate = format(currentDate, 'yyyy-MM-dd');

    const query: any = {
      remittanceDate: { $gte: currDate }
    };

    if (searchTerm) {
      if (sortField !== 'score' && searchTerm) {
        query.$text = { $search: searchTerm };
      } else {
        query.$or = [
          { remittanceId: { $regex: searchTerm, $options: 'i' } },
          { BankTransactionId: { $regex: searchTerm, $options: 'i' } },
          { 'orders.awb': { $regex: searchTerm, $options: 'i' } }
        ];
      }
    }

    if (req.query.sellerId) {
      query.sellerId = req.query.sellerId;
    }

    const total = await RemittanceModel.countDocuments(query);

    const sortOptions: any = {};
    if (searchTerm && sortField === 'score') {
      sortOptions.score = { $meta: 'textScore' };
    } else {
      sortOptions[sortField] = sortOrder;
    }

    const futureRemittances = await RemittanceModel.find(
      query,
      {
        BankTransactionId: 1,
        remittanceStatus: 1,
        remittanceDate: 1,
        remittanceId: 1,
        remittanceAmount: 1,
        sellerId: 1,
        orders: {
          $map: {
            input: "$orders",
            as: "order",
            in: {
              orderStages: "$$order.orderStages",
              awb: "$$order.awb"
            }
          }
        },
        ...(searchTerm && sortField === 'score' ? { score: { $meta: 'textScore' } } : {})
      }
    )
      .populate("sellerId", "name email")
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    if (!futureRemittances.length) {
      return res.status(200).send({
        valid: false,
        message: "No Future Remittance found",
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0
        }
      });
    }

    return res.status(200).send({
      valid: true,
      remittanceOrders: futureRemittances,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error in getFutureRemittances:", error);
    return res.status(500).send({ valid: false, message: "Error in fetching remittance" });
  }
};

export const getRemittanceAnalytics = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId, period } = req.query;

    // Set date range based on period
    const dateRange: any = {};
    const now = new Date();

    switch (period) {
      case 'week':
        dateRange.$gte = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        dateRange.$gte = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'quarter':
        dateRange.$gte = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case 'year':
        dateRange.$gte = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        // Default to last 30 days
        dateRange.$gte = new Date(now.setDate(now.getDate() - 30));
    }
    dateRange.$lte = new Date();

    // Build match stage for aggregation
    const matchStage: any = {
      remittanceDate: dateRange
    };

    if (sellerId) {
      matchStage.sellerId = new mongoose.Types.ObjectId(sellerId as string);
    }

    // Perform aggregation
    const result = await RemittanceModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$remittanceDate" }
          },
          totalAmount: { $sum: "$remittanceAmount" },
          count: { $sum: 1 },
          statuses: {
            $push: "$remittanceStatus"
          }
        }
      },
      {
        $project: {
          date: "$_id",
          totalAmount: 1,
          count: 1,
          statuses: 1,
          _id: 0
        }
      },
      { $sort: { date: 1 } }
    ]);

    return res.status(200).send({
      valid: true,
      analytics: result
    });
  } catch (error) {
    console.error("Error in getRemittanceAnalytics:", error);
    return res.status(500).send({ valid: false, message: "Error in fetching analytics" });
  }
};

export const manageSellerRemittance = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { remittanceId, bankTransactionId, status } = req.body;
    const remittance = await RemittanceModel.findById(remittanceId);
    if (!remittance) {
      return res.status(404).send({ valid: false, message: "Remittance not found" });
    }

    remittance.BankTransactionId = bankTransactionId;
    remittance.remittanceStatus = status;
    await remittance.save();

    return res.status(200).send({
      valid: true,
      message: "Remittance updated successfully",
    });
  } catch (err) {
    return next(err);
  }
}

export const getInvoices = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { sellerId } = req.query;
    const invoices = await InvoiceModel.find({ sellerId });
    return res.status(200).send({ valid: true, invoices });
  } catch (error) {
    return next(error)
  }
}

export const getInoviceById = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const invoice = await InvoiceModel.findById(req.params.id);
    if (!invoice) return res.status(200).send({ valid: false, message: "No Invoice found" });

    return res.status(200).send({ valid: true, invoice });
  } catch (error) {
    return next(error)
  }
}

export const generateInvoices = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await calculateSellerInvoiceAmount();
    if (result.status === 200) {
      return res.status(200).send({ valid: true, message: "Invoices generated successfully!" });
    }
    return res.status(200).send({ valid: false, message: "Error in generating invoices" });
  } catch (err) {
    return next(err);
  }
}

export const postpaidInvoicePayment = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {

    const body = req.body;
    const { invoiceNumber, amount, paymentReference, transactionDate, bankName } = body

    const invoice = await InvoiceModel.findById(invoiceNumber);
    if (!invoice) return res.status(404).json({ message: "No Invoice found" })

    const invoiceId = invoice.invoice_id

    const seller = await SellerModel.findById(invoice?.sellerId);
    if (!seller) return;

    const zoho_contact_id = seller.zoho_contact_id

    const accessToken = await generateAccessToken();
    if (!accessToken) return;

    const invoiceRes = await axios.get(
      `https://www.zohoapis.in/books/v3/invoices/${invoiceId}?organization_id=60014023368`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }
    );

    const invoiceTotalZoho = invoiceRes.data.invoice.total;

    // pay-in-due
    let status = ""
    if (amount < invoiceTotalZoho) {
      status = "Pay-In-Due"
    } else {
      status = "Paid"
    }

    const rechargeBody = {
      customer_id: zoho_contact_id,
      amount: amount,
    }

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
          amount_applied: amount,
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

    await invoice.updateOne({
      pdf: pdfBase64,
      status: status,
      date: invoiceRes.data.invoice.date,
    })
    return res.status(200).send({ valid: true, message: "Payment Successfull!" });
  } catch (err) {
    return next(err);
  }
}

export const getSubAdmins = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const subadmins = await SellerModel.find({ issubadmin: true }).select(["name", "subadminpaths"])
    return res.status(200).send({ valid: true, subadmins });
  } catch (err) {
    return next(err)
  }
}

export const getAllInvoices = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const invoices = await InvoiceModel.find({}).populate("sellerId", "name");
    return res.status(200).send({ valid: true, invoices });
  } catch (error) {
    return next(error)
  }
}

export const updateSubadminPaths = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { paths } = req.body;


    if (!paths || !Array.isArray(paths)) {
      return res.status(400).send({ valid: false, message: "Invalid paths array" });
    }

    const subadmin = await SellerModel.findById(req.params.id);
    if (!subadmin) {
      return res.status(404).send({ valid: false, message: "No Subadmin found" });
    }

    subadmin.subadminpaths = paths;
    await subadmin.save();

    return res.status(200).send({ valid: true, message: "Subadmin paths updated successfully" });
  } catch (err) {
    return next(err);
  }
};

export const deleteSubadmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const subadmin = await SellerModel.findById(req.params.id);
    if (!subadmin) {
      return res.status(404).send({ valid: false, message: "No Subadmin found" });
    }

    const deleted = await SellerModel.findByIdAndDelete(req.params.id);

    return res.status(200).send({ valid: true, message: "Subadmin deleted successfully", deleted });

  } catch (err) {
    return next(err);
  }
}

export const getDisputes = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const disputes = await SellerDisputeModel.find({ accepted: false }).populate("sellerId", "name").populate("clientBillingId")
    return res.status(200).send({ valid: true, disputes });
  } catch (error) {
    return next(error)
  }
}

export const getDisputeById = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const dispute = await SellerDisputeModel.findById(req.params.id);
    if (!dispute) return res.status(200).send({ valid: false, message: "No Dispute found" });
    const order = await B2COrderModel.findOne({ awb: dispute.awb });

    return res.status(200).send({ valid: true, dispute, order });
  } catch (error) {
    return next(error)
  }
}

export const acceptDispute = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { disputeId, chargedWeight } = req.body;
    const dispute = await SellerDisputeModel.findById(disputeId);
    if (!dispute) {
      return res.status(404).send({ valid: false, message: "No Dispute found" });
    }

    const order: any = await B2COrderModel.find({ awb: dispute.awb })
    if (!order) {
      throw new Error(`Order not found for AWB: ${dispute.awb}`);
    }

    const bill = await ClientBillingModal.findOne({ awb: dispute.awb });

    if (!bill) {
      throw new Error("Billing Not Found!")
    }

    let vendor: any = await CustomPricingModel.findOne({
      sellerId: order.sellerId,
      vendorId: bill.carrierID
    }).populate({
      path: 'vendorId',
      populate: {
        path: 'vendor_channel_id'
      }
    });

    if (!vendor) {
      vendor = await CourierModel.findById(bill.carrierID).populate("vendor_channel_id");
    }

    const csvBody = {
      weight: chargedWeight,
      paymentType: bill.shipmentType,
      collectableAmount: Math.max(0, order.amount2Collect),
    };

    const { totalCharge, codCharge, fwCharge } = await calculateShippingCharges(bill.zone, csvBody, vendor, await calculateZone(order.pickupAddress.pincode, order.customerDetails.pincode), order.orderWeight); // csv calc 

    let fwExcessCharge: any = bill.fwExcessCharge;
    if (Number(fwCharge) > Number(bill.rtoCharge)) {
      fwExcessCharge = (fwCharge - Number(bill.rtoCharge)).toFixed(2)
    }

    const rtoCharge = (totalCharge - (codCharge || 0)).toFixed(2)

    const billingAmount = bill.isRTOApplicable ? Math.max(0, ((totalCharge - order.shipmentCharges) + Number(rtoCharge))).toFixed(2) : (Math.max(0, totalCharge - order.shipmentCharges)).toFixed(2);

    // console.log({
    //   codValue: codCharge,
    //   fwExcessCharge,
    //   rtoCharge,
    //   orderWeight: order.orderWeight,
    //   billingAmount: billingAmount, // fw+RTO without COD Charge
    //   chargedWeight: chargedWeight,
    // })
    await Promise.all([
      bill.updateOne({
        codValue: codCharge,
        fwExcessCharge,
        rtoCharge,
        orderWeight: order.orderWeight,
        billingAmount: billingAmount, // fw+RTO without COD Charge
        chargedWeight: chargedWeight,
      }),

      MonthlyBilledAWBModel.findOneAndUpdate(
        { sellerId: order.sellerId, awb: order.awb },
        {
          billingAmount: billingAmount,
          chargedWeight: dispute.chargedWeight,
        },
        {
          new: true,
          setDefaultsOnInsert: true,
          upsert: true,
        }
      ),
    ]);

    dispute.accepted = true;
    await dispute.save();

    return res.status(200).send({ valid: true, message: "Dispute accepted successfully" });
  }
  catch (error) {
    return next(error)
  }
}

export const rejectDispute = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { disputeId } = req.body;
    const dispute = await SellerDisputeModel.findById(disputeId);
    if (!dispute) {
      return res.status(404).send({ valid: false, message: "No Dispute found" });
    }
    dispute.stage = 4
    dispute.save();

    return res.status(200).send({ valid: true, message: "Dispute rejected successfully", dispute });
  }
  catch (error) {
    return next(error)
  }
}

export const invoiceAwbListAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const invoice = await InvoiceModel.find({ invoice_id: req.params.id });

    if (!invoice) return res.status(200).send({ valid: false, message: "No Invoice found" });
    //@ts-ignore
    const awbs = invoice[0]?.invoicedAwbs;

    if (!awbs) return res.status(400).send({ valid: false, awbTransacs: null })

    const result = await generateListInoviceAwbs(awbs, req.params.id)

    return res.status(200).send({ valid: true, awbTransacs: result });
  } catch (error) {
    return next(error);
  }
};


export const mapInoiceAwbTransactions = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const invoices = await InvoiceModel.find({}).select(["invoice_id", "invoicedAwbs"]);
    invoices.forEach(async (invoice) => {
      const awbs = invoice.invoicedAwbs || [];
      const awbTransacs: any[] = [];
      const bills = await ClientBillingModal.find({ awb: { $in: awbs } });
      awbs.forEach((awb: any) => {
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


        const awbObj = {
          awb,
          invoiceNo: invoice.invoice_id,
          forwardCharges,
          rtoCharges,
          codCharges,
          total: forwardCharges + rtoCharges + codCharges,
          zone: bill?.zone,
          recipientName: bill?.recipientName,
          fromCity: bill?.fromCity,
          toCity: bill?.toCity,
          orderId: bill?.orderRefId,
        }
        awbTransacs.push(awbObj);
      });
    })

  } catch (error) {
    return next(error);
  }
}