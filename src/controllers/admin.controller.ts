import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2BOrderModel, B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import { Types, isValidObjectId } from "mongoose";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { calculateShippingCharges, convertToISO, csvJSON, updateSellerWalletBalance, validateClientBillingFeilds } from "../utils";
import PincodeModel from "../models/pincode.model";
import CourierModel from "../models/courier.model";
import CustomPricingModel, { CustomB2BPricingModel } from "../models/custom_pricing.model";
import { nextFriday } from "../utils";
import ClientBillingModal from "../models/client.billing.modal";
import csvtojson from "csvtojson";
import exceljs from "exceljs";
import { format } from "date-fns";
import InvoiceModel from "../models/invoice.model";
import { generateAccessToken } from "../utils/helpers";
import axios from "axios";
import B2BCalcModel from "../models/b2b.calc.model";
import { isValidPayload } from "../utils/helpers";

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

    let orders, orderCount, b2borders;
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

      b2borders = (await B2BOrderModel
        .find(query)
        .sort({ createdAt: -1 })
        .populate("customer")
        .populate("sellerId")
        .populate("pickupAddress")
        .lean()).reverse();

      orderCount =
        status && obj.hasOwnProperty(status)
          ? await B2COrderModel.countDocuments(query)
          : await B2COrderModel.countDocuments({});
    } catch (err) {
      return next(err);
    }
    return res.status(200).send({
      valid: true,
      response: { orders, orderCount, b2borders },
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
    const currDate = format(currentDate, 'yy-MM-dd');
    const futureRemittances = await RemittanceModel.find({
      remittanceDate: { $gte: currDate },
    }).populate("sellerId").lean();;
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
  const new_id = req.query?.sellerId;
  if (body?.password) return res.status(200).send({ valid: false, message: "Invalid payload" });

  try {
    const existingSeller = await SellerModel.findById(new_id).select("-__v -password -margin");

    if (!existingSeller) {
      return res.status(404).send({ valid: false, message: "Seller not found" });
    }

    const updatedData = { ...existingSeller.toObject(), ...body };

    const updatedSeller = await SellerModel.findByIdAndUpdate(
      new_id,
      { $set: updatedData },
      { new: true, select: "-__v -password -margin" }
    );

    if (body.isVerified === true) {
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
      console.log(updateRes, 'updateRes');
    }

    return res.status(200).send({
      valid: true,
      message: "Updated successfully",
      seller: updatedSeller,
    });
  } catch (err) {
    return next(err);
  }
};

export const updateSellerConfig = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { isD2C, isB2B, isPrepaid, isPostpaid } = req.body;
    const { sellerId } = req.params;

    if (!sellerId) {
      return res.status(400).send({ error: "Seller ID is required" });
    }

    const update = {
      $set: {
        'config.isD2C': isD2C,
        'config.isB2B': isB2B,
        'config.isPrepaid': isPrepaid,
        'config.isPostpaid': isPostpaid
      }
    };

    const updatedSeller = await SellerModel.findByIdAndUpdate(sellerId, update, { new: true });

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
    const fileData = req.file.buffer.toString();
    var data = fileData.replace(/,\s+/g, ",");
    const pincodes = csvJSON(data);

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
    const b2bCouriers = await B2BCalcModel.find().populate("vendor_channel_id").lean();
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
    const b2bCouriersWNickName = b2bCouriers.map((courier) => {
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
      b2bCouriers: b2bCouriersWNickName,
    });
  } catch (err) {
    return next(err);
  }
}

// B2C
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
    const seller = await SellerModel.findById(sellerId);
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

    const seller = await SellerModel.findById(sellerId).lean();
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
    const seller = await SellerModel.findById(sellerId);
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

  const bills = json.map((bill: any) => {
    const isForwardApplicable = Boolean(bill["Forward Applicable"]?.toUpperCase() === "YES");
    const isRTOApplicable = Boolean(bill["RTO Applicable"]?.toUpperCase() === "YES");
    return {
      billingDate: convertToISO(bill["Date"]),
      awb: bill["Awb"],
      rtoAwb: bill["RTO Awb"],
      codValue: Number(bill["COD Value"] || 0),
      orderRefId: bill["Order id"],
      recipientName: bill["Recipient Name"],
      shipmentType: bill["Shipment Type"] === "COD" ? 1 : 0,
      fromCity: bill["Origin City"],
      toCity: bill["Destination City"],
      chargedWeight: Number(bill["Charged Weight"]),
      zone: bill["Zone"],
      carrierID: Number(bill["Carrier ID"]),
      isForwardApplicable,
      isRTOApplicable,
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
        const error = validateClientBillingFeilds(value, fieldName, bill, alreadyExistingBills);
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

    const orderRefIds = bills.map(bill => bill.orderRefId);
    const orders = await B2COrderModel.find({
      $or: [
        { order_reference_id: { $in: orderRefIds } },
        { client_order_reference_id: { $in: orderRefIds } }
      ]
    }).populate(["productId", "pickupAddress"]);

    const orderRefIdToSellerIdMap = new Map();
    orders.forEach(order => {
      orderRefIdToSellerIdMap.set(order.order_reference_id || order.client_order_reference_id, order.sellerId);
    });

    const billsWithCharges = await Promise.all(bills.map(async (bill) => {
      const order: any = orders.find(o => o.order_reference_id === bill.orderRefId || o.client_order_reference_id === bill.orderRefId);
      if (!order) {
        throw new Error(`Order not found for Order Ref Id: ${bill.orderRefId}`);
      }

      const vendor: any = await CourierModel.findOne({ carrierID: bill.carrierID }).populate("vendor_channel_id");
      const pickupDetails = {
        District: bill.fromCity,
        StateName: order.pickupAddress.state,
      };
      const deliveryDetails = {
        District: bill.toCity,
        StateName: order.customerDetails.get("state"),
      };
      const body = {
        weight: bill.chargedWeight,
        paymentType: bill.shipmentType,
        collectableAmount: bill.codValue,
      };
      const { incrementPrice, totalCharge } = await calculateShippingCharges(pickupDetails, deliveryDetails, body, vendor);
      const baseWeight = vendor?.weightSlab || 0;
      const incrementWeight = Number(order.orderWeight) - baseWeight;

      return {
        ...bill,
        sellerId: order.sellerId,
        billingAmount: totalCharge,
        incrementPrice: incrementPrice.incrementPrice,
        basePrice: incrementPrice.basePrice,
        incrementWeight: incrementWeight.toString(),
        baseWeight: baseWeight.toString(),
        vendorWNickName: `${vendor.name} ${vendor.vendor_channel_id.nickName}`,
      };
    }));

    await ClientBillingModal.insertMany(billsWithCharges);

    await Promise.all(billsWithCharges.map(async (bill: any) => {
      if (bill.sellerId && bill.billingAmount) {
        await updateSellerWalletBalance(bill.sellerId, bill.billingAmount, false, `AWB: ${bill.awb}, Revised`);
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
    const data = await ClientBillingModal.find({}).populate("sellerId").lean();
    if (!data) return res.status(200).send({ valid: false, message: "No Client Billing found" });
    return res.status(200).send({
      valid: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}
export const getClientBillingData = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const data = await ClientBillingModal.find({}).populate("sellerId").lean();
    if (!data) return res.status(200).send({ valid: false, message: "No Client Billing found" });
    return res.status(200).send({
      valid: true,
      data
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