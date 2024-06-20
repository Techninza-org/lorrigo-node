import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import { isValidObjectId } from "mongoose";
import RemittanceModel from "../models/remittance-modal";
import SellerModel from "../models/seller.model";
import { calculateShippingCharges, convertToISO, csvJSON, updateSellerWalletBalance, validateClientBillingFeilds } from "../utils";
import PincodeModel from "../models/pincode.model";
import CourierModel from "../models/courier.model";
import CustomPricingModel from "../models/custom_pricing.model";
import { nextFriday } from "../utils";
import ClientBillingModal from "../models/client.billing.modal";
import csvtojson from "csvtojson";
import exceljs from "exceljs";
import { format } from "date-fns";


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

    return res.status(200).send({
      valid: true,
      message: "Updated successfully",
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
    const customPricingMap = new Map(customPricings.map(courier => [courier?.vendorId?._id.toString(), courier]));

    const couriersWithNickname = couriers.map((courier) => {
      const customPricing = customPricingMap.get(courier._id.toString());
      // @ts-ignore
      const { vendor_channel_id, ...courierData } = customPricing || courier;
      // @ts-ignore
      let nameWithNickname = `${courierData?.name || courierData?.vendorId?.name} ${vendor_channel_id?.nickName || courierData?.vendorId?.vendor_channel_id?.nickName}`.trim();
      if (customPricing) {
        // If custom pricing exists, append "Custom" to the nickname
        nameWithNickname += " Custom";
      }

      return {
        ...courier,
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

    const updatedSellerCourier = couriers.filter((courierId) => seller.vendors.includes(courierId));
    console.log(updatedSellerCourier, 'updatedSellerCourier')
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
  })

  if (bills.length < 1) {
    return res.status(200).send({
      valid: false,
      message: "empty payload",
    });
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
        errorRows.push({
          awb: bill.awb,
          errors: errors.join(", ")
        });
      }
    });


    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

      await errorWorkbook.csv.write(res);
      return res.end();
    }

    // // find sellerId from orderRefId from B2COrderModel
    let orders: any[] = [];
    try {
      const orderRefIds = bills.map(bill => bill.orderRefId);
      orders = await B2COrderModel.find({ order_reference_id: { $in: orderRefIds } }).populate(["productId", "pickupAddress"]);
      const orderRefIdToSellerIdMap = new Map();
      orders.forEach(order => {
        orderRefIdToSellerIdMap.set(order.order_reference_id, order.sellerId);
      });

    } catch (error) {
      console.log(error, 'error');
    }

    try {
      const billsWithCharges = await Promise.all(bills.map(async (bill) => {
        const order: any = orders.find(o => o.order_reference_id === bill.orderRefId);
        const vendor = await CourierModel.findOne({ carrierID: bill.carrierID });
        if (order) {
          const pickupDetails = {
            // @ts-ignore
            District: bill.fromCity,
            // @ts-ignore
            StateName: order.pickupAddress.state,
          };
          const deliveryDetails = {
            // @ts-ignore
            District: bill.toCity,
            // @ts-ignore
            StateName: order.customerDetails.get("state"),
          };
          const body = {
            weight: bill.chargedWeight,
            paymentType: bill.shipmentType,
            collectableAmount: bill.codValue,
          };
          const totalCharge = await calculateShippingCharges(
            pickupDetails,
            deliveryDetails,
            body,
            vendor
          );

          return {
            ...bill,
            sellerId: order.sellerId,
            billingAmount: totalCharge,
          };
        } else {
          return res.status(400).json({ valid: false, message: "Order not found, Please Emter the valid Order Ref Id!" });
        }
      }));
      const bulkInsertBills = await ClientBillingModal.insertMany(billsWithCharges);

      billsWithCharges.forEach(async (bill: any) => {
        if (bill.sellerId && bill.billingAmount) {
          await updateSellerWalletBalance(bill.sellerId, bill.billingAmount, false)
        }
      })

      return res.status(200).send({
        valid: true,
        message: "Billing uploaded successfully",
        bulkInsertBills
      });
    } catch (error) {
      return next(error);
    }

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
      data,
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