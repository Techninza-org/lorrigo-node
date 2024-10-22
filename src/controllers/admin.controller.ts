import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import { Types, isValidObjectId } from "mongoose";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { calculateShippingCharges, convertToISO, csvJSON, updateSellerWalletBalance, validateB2BClientBillingFeilds, validateClientBillingFeilds } from "../utils";
import PincodeModel from "../models/pincode.model";
import CourierModel from "../models/courier.model";
import CustomPricingModel, { CustomB2BPricingModel } from "../models/custom_pricing.model";
import ClientBillingModal from "../models/client.billing.modal";
import csvtojson from "csvtojson";
import exceljs from "exceljs";
import { format } from "date-fns";
import InvoiceModel from "../models/invoice.model";
import { calculateSellerInvoiceAmount, generateAccessToken } from "../utils/helpers";
import axios from "axios";
import B2BCalcModel from "../models/b2b.calc.model";
import { isValidPayload } from "../utils/helpers";
import PaymentTransactionModal from "../models/payment.transaction.modal";
import B2BClientBillingModal from "../models/b2b-client.billing.modal";
import { calculateRateAndPrice, regionToZoneMappingLowercase } from "../utils/B2B-helper";
import { MonthlyBilledAWBModel } from "../models/billed-awbs-month";

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
    const { from, to, status }: { from?: string, to?: string, status?: string } = req.query;

    // Define status buckets
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

    const [orders, b2borders] = await Promise.all([
      B2COrderModel.find(query)
        .sort({ createdAt: -1 })
        .populate("productId")
        .populate("pickupAddress")
        .populate({
          path: "sellerId",
          select: "name"
        })
        .lean(),
      B2BOrderModel.find(query)
        .sort({ createdAt: -1 })
        .populate("customer")
        .populate("pickupAddress")
        .populate({
          path: "sellerId",
          select: "name"
        })
        .select('-invoiceImage')
        .lean()
    ]);


    return res.status(200).send({
      valid: true,
      response: { orders, b2borders: b2borders.reverse() },
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

export const getAllRemittances = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to }: { from?: string, to?: string, status?: string } = req.query;

    const query: { createdAt?: any } = {};

    if (from || to) {
      const createdAtQuery: any = {};

      if (from) {
        const fromDate = new Date(from.split("/").reverse().join("-") + "T00:00:00.000Z");
        createdAtQuery.$gte = fromDate;
      }

      if (to) {
        const toDate = new Date(to.split("/").reverse().join("-") + "T23:59:59.999Z");
        createdAtQuery.$lte = toDate;
      }

      if (Object.keys(createdAtQuery).length > 0) {
        query.createdAt = createdAtQuery;
      }
    }

    const remittanceOrders = await RemittanceModel.find(
      {},
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
              awb: "$$order.awb",
            },
          },
        },
      }
    )
      .populate("sellerId")
      .lean()
      .sort({ remittanceDate: -1 });

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
    const currDate = format(currentDate, 'yyyy-MM-dd');

    const futureRemittances = await RemittanceModel.find(
      {
        remittanceDate: { $gte: currDate },
      },
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
        }
      }
    )
      .populate("sellerId", "name email")
      .lean()
      .sort({ remittanceDate: -1 })

    return res.status(200).send({
      valid: true,
      remittanceOrders: futureRemittances,
    });
  } catch (error) {
    return res.status(500).send({ valid: false, message: "Error in fetching remittance" });
  }
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
        console.log(updateRes, 'updateRes[zoho]');
      } catch (error) {
        console.log(error, 'error');
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
  } catch (err) {
    console.log(err, 'err')
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
  } catch (err) {
    console.log(err, 'err');

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
  } catch (err) {
    console.log(err, 'err')
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
  } catch (err) {
    console.log(err, 'err');

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

          console.log(toAdd, "toAdd")
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


export const uploadClientBillingCSV = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).send({ valid: false, message: "No file uploaded" });
  }

  const alreadyExistingBills = await ClientBillingModal.find({}).select(["orderRefId", "awb", "rtoAwb"]);
  const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

  const csvBills = json.map((bill: any) => {
    const isForwardApplicable = Boolean(bill["Forward Applicable"]?.toUpperCase() === "YES");
    const isRTOApplicable = Boolean(bill["RTO Applicable"]?.toUpperCase() === "YES");
    
    return {
      awb: (bill["Awb"]).toString(),
      codValue: Number(bill["COD Value"] || 0),
      shipmentType: bill["Shipment Type"] === "COD" ? 1 : 0,
      chargedWeight: Number(bill["Charged Weight"]),
      zone: bill["Zone"],
      carrierID: bill["Carrier ID"],
      isForwardApplicable,
      isRTOApplicable,
    };
  });

  const bills = csvBills.filter((bill: any) => !!bill.awb);

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

    // Validate each bill and collect errors for invalid fields
    bills.forEach((bill) => {
      const errors: string[] = [];
      Object.entries(bill).forEach(([fieldName, value]) => {
        const error = validateClientBillingFeilds(value, fieldName, bill, alreadyExistingBills);
        if (error) {
          errors.push(error);
        }
      });

      if (errors.length > 0) {
        errorRows.push({ awb: bill.awb, errors: errors.join(", ") });
      }
    });

    const orderAwbs = bills.map(bill => bill.awb);
    const orders = await B2COrderModel.find({
      $or: [{ awb: { $in: orderAwbs } }],
    }).populate(["productId", "pickupAddress"]);

    const orderRefIdToSellerIdMap = new Map();
    orders.forEach(order => {
      orderRefIdToSellerIdMap.set(order.order_reference_id || order.client_order_reference_id, order.sellerId);
    });

    const currentMonth = format(new Date(), 'yyyy-MM-dd');

    // Handling missing AWBs: collect AWBs not found in the database
    bills.forEach(bill => {
      const order = orders.find(o => o.awb === bill.awb);
      if (!order) {
        errorRows.push({ awb: bill.awb, errors: "AWB not found in the database" });
      }
    });

    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

      await errorWorkbook.csv.write(res);
      return res.end();
    }

    const billsWithCharges = await Promise.all(bills.map(async (bill) => {
      const order: any = orders.find(o => o.awb === bill.awb);
      if (!order) {
        throw new Error(`Order not found for AWB: ${bill.awb}`);
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

      const body = {
        weight: bill.chargedWeight,
        paymentType: bill.shipmentType,
        collectableAmount: bill.codValue,
      };

      const { incrementPrice, totalCharge, codCharge } = await calculateShippingCharges(bill.zone, body, vendor);
      const baseWeight = (vendor?.weightSlab || vendor?.vendorId?.weightSlab) || 0;
      const incrementWeight = bill.chargedWeight - Number(order.orderWeight) - baseWeight;

      const rtoCharge = (totalCharge - (codCharge || 0))

      const billingAmount =  bill.isRTOApplicable ? ((totalCharge - order.shipmentCharges) + rtoCharge).toFixed(2) : (totalCharge - order.shipmentCharges).toFixed(2);

      const existingMonthBill: any = await MonthlyBilledAWBModel.findOne({
        sellerId: order.sellerId,
        awb: order.awb,
      });

      if (existingMonthBill && existingMonthBill.isRTOApplicable === true) {
        errorRows.push({ awb: bill.awb, errors: "Not Allowd: Awb is already billed for forward and RTO" });
        return;
      }

      const monthBill = await MonthlyBilledAWBModel.findOneAndUpdate(
        { sellerId: order.sellerId, awb: order.awb },
        {
          sellerId: order.sellerId,
          awb: order.awb,
          billingDate: currentMonth,
          billingAmount: billingAmount,
          zone: bill.zone,
          incrementPrice: incrementPrice.incrementPrice,
          basePrice: incrementPrice.basePrice,
          chargedWeight: incrementWeight > 0 ? incrementWeight.toString() : "0",
          baseWeight: baseWeight.toString(),
          isForwardApplicable: bill.isForwardApplicable,
          isRTOApplicable: bill.isRTOApplicable,
        },
        {
          new: true,
          setDefaultsOnInsert: true,
        }
      );
      return {
        updateOne: {
          filter: { awb: bill.awb },
          update: {
            $set: {
              ...bill,
              carrierID: bill.carrierID,
              sellerId: order.sellerId,
              codValue: codCharge,
              rtoCharge,
              orderWeight: order.orderWeight,
              orderCharges: order.shipmentCharges, // applied_weight charge
              billingAmount: billingAmount, // Ensure this is set correctly
              incrementPrice: incrementPrice.incrementPrice, // cc
              basePrice: incrementPrice.basePrice, // cc
              incrementWeight: incrementWeight >= 0 ? incrementWeight.toString() : 0,
              baseWeight: baseWeight.toString(),  // cc
              vendorWNickName: `${vendor?.name || vendor?.vendorId?.name} ${vendor?.vendor_channel_id?.nickName || vendor?.vendorId?.vendor_channel_id.nickName}`.trim(),
              billingDate: format(new Date(), 'yyyy-MM-dd'),
              rtoAwb: "",
              orderRefId: order.order_reference_id,
              recipientName: order.customerDetails.get("name"),
              fromCity: order.pickupAddress.city,
              toCity: order.customerDetails.get("city"),
            }
          },
          upsert: true
        }
      };
    }));


    const validBills = billsWithCharges.filter(x => !!x)
    // @ts-ignore
    await ClientBillingModal.bulkWrite(validBills);

    await Promise.all(validBills.map(async (bill: any) => {
      const sellerId = bill.updateOne.update.$set.sellerId
      const amountToDeduct = Number(bill.updateOne.update.$set.billingAmount);
      const awbToDeduct = bill.updateOne.filter.awb;

      if (sellerId && amountToDeduct && amountToDeduct > 0) {
        await updateSellerWalletBalance(sellerId, amountToDeduct, false, `AWB: ${awbToDeduct}, Revised`);
      }
    }));

    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');
      await errorWorkbook.csv.write(res);
      return res.end();
    }

    return res.status(200).send({ valid: true, message: "Billing data uploaded successfully" });
  } catch (error) {
    console.error("Error in uploadClientBillingCSV:", error);
    return res.status(500).send({ valid: false, message: "An error occurred while processing the request" });
  }
};

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
        throw new Error('Zone not found for the given region');
      }

      const result = await calculateRateAndPrice(courier, Fzone, Tzone, bill.orderWeight, courier?._id?.toString(), fromRegionName, toRegionName, order.amount, bill.otherCharges, bill.isODAApplicable);

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
              billingDate: new Date()?.toISOString() ?? "",
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
    await B2BClientBillingModal.bulkWrite(billsWithCharges);

    await Promise.all(billsWithCharges.map(async (bill: any) => {
      if (bill.sellerId && bill.billingAmount) {
        await updateSellerWalletBalance(bill.sellerId, (bill.billingAmount), false, `AWB: ${bill.awb}, Revised B2B`);
      }
    }));

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

    const billedAwbs = data.map(bill => bill.awb);
    const billsStatus = await MonthlyBilledAWBModel.find({ awb: { $in: billedAwbs } });

    const billsWStatus = data.map((bill: any) => {
      const statusEntry: any = billsStatus.find(status => status.awb === bill.awb);
      let status = 'Forward Billed'
      
      if (statusEntry.isRTOApplicable) {
        status = 'Forward + RTO Billed'
      }

      return {
        ...bill._doc,
        status
      };
    });


    return res.status(200).send({
      valid: true,
      data: billsWStatus.reverse(),
      b2bData: b2bData.reverse()
    });
  } catch (error) {
    return next(error);
  }
}

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
    await calculateSellerInvoiceAmount();
    return res.status(200).send({ valid: true, message: "Invoices generated successfully!" });
  } catch (err) {
    return next(err);
  }
}

export const getSubAdmins = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try{
    const subadmins = await SellerModel.find({issubadmin: true}).select(["name", "subadminpaths"])
    return res.status(200).send({ valid: true, subadmins });
  }catch(err){
    return next(err)
  }
}

export const updateSubadminPaths  = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try{
    const {paths} = req.body 
    const subadmin = await SellerModel.findById(req.params.id);
    if (!subadmin) return res.status(200).send({ valid: false, message: "No Subadmin found" });
    subadmin.subadminpaths = paths
    await subadmin.save();
    return res.status(200).send({ valid: true, message: "Subadmin paths updated successfully" });
  }catch(err){
    return next(err)
  }
}