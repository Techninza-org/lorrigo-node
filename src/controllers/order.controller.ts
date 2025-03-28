import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel, B2BOrderModel } from "../models/order.model";
import ProductModel from "../models/product.model";
import HubModel from "../models/hub.model";
import { format, parse } from "date-fns";
import {
  getPincodeDetails,
  getSellerChannelConfig,
  getShiprocketToken,
  isValidPayload,
  rateCalculation,
} from "../utils/helpers";
import { isValidObjectId } from "mongoose";
import { ObjectId } from "mongoose";
import envConfig from "../utils/config";
import axios from "axios";
import APIs from "../utils/constants/third_party_apis";

import csvtojson from "csvtojson";
import exceljs from "exceljs";

import { DELIVERED, IN_TRANSIT, NDR, NEW, NEW_ORDER_DESCRIPTION, NEW_ORDER_STATUS, READY_TO_SHIP, RETURN_CANCELLATION, RETURN_CONFIRMED, RETURN_DELIVERED, RETURN_IN_TRANSIT, RETURN_PICKED, RTO, RTO_DELIVERED } from "../utils/lorrigo-bucketing-info";
import { convertToISO, registerOrderOnShiprocket, validateBulkOrderField } from "../utils";
import CourierModel from "../models/courier.model";
import { calculateB2BPriceCouriers, getB2BShiprocketServicableOrder, registerB2BShiprocketOrder } from "../utils/B2B-helper";
import { OrderDetails } from "../types/b2b";
import { validateOrderPayload } from "../utils/validation-helper";

// TODO create api to delete orders

export const createB2COrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    const customerDetails = body?.customerDetails;
    const productDetails = body?.productDetails;

    const validationResult = validateOrderPayload(body);
    if (!validationResult.valid) {
      return res.status(400).send(validationResult);
    }

    try {
      const orderWithOrderReferenceId = await B2COrderModel.findOne({
        sellerId: req.seller._id,
        order_reference_id: body?.order_reference_id,
      }).lean();

      if (orderWithOrderReferenceId) {
        const newError = new Error("Order reference Id already exists.");
        return next(newError);
      }
    } catch (err) {
      return next(err);
    }

    let hubDetails;
    try {
      hubDetails = await HubModel.findById(body?.pickupAddress);
      if (!hubDetails) return res.status(200).send({ valid: false, message: "Pickup address doesn't exists" });

    } catch (err) {
      return next(err);
    }


    let savedProduct;
    try {
      const { name, category, hsn_code, quantity, taxRate, taxableValue } = productDetails;
      const product2save = new ProductModel({
        name,
        category,
        hsn_code,
        quantity,
        tax_rate: taxRate,
        taxable_value: taxableValue,
      });
      savedProduct = await product2save.save();
    } catch (err) {
      return next(err);
    }

    const deliveryDetails = await getPincodeDetails(Number(body.customerDetails.pincode));

    if (!deliveryDetails) {
      return res.status(200).send({ valid: false, message: "Pincode is not serviceable!" });
    }

    const orderboxUnit = "kg";

    const orderboxSize = "cm";
    let savedOrder;
    const data = {
      sellerId: req.seller?._id,
      ewaybill: body?.ewaybill,
      isReverseOrder: body?.isReverseOrder,
      bucket: NEW,
      client_order_reference_id: body?.client_order_reference_id || body?.order_reference_id,
      orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
      pickupAddress: body?.pickupAddress,
      productId: savedProduct._id,
      order_reference_id: body?.order_reference_id,
      payment_mode: body?.payment_mode,
      order_invoice_date: body?.order_invoice_date || new Date().toISOString(),
      order_invoice_number: body?.order_invoice_number.toString(),
      isContainFragileItem: body?.isContainFragileItem,
      numberOfBoxes: body?.numberOfBoxes, // if undefined, default=> 0
      orderBoxHeight: body?.orderBoxHeight,
      orderBoxWidth: body?.orderBoxWidth,
      orderBoxLength: body?.orderBoxLength,
      orderSizeUnit: body?.orderSizeUnit,
      orderWeight: body?.orderWeight,
      orderWeightUnit: body?.orderWeightUnit,
      productCount: body?.productCount,
      amount2Collect: body?.amount2Collect,
      customerDetails: {
        ...body?.customerDetails,
        name: body.customerDetails.name.replace(/[^A-Za-z\s]/g, "")
      },
      ...(body?.orderItems && { orderItems: body?.orderItems }),
      sellerDetails: {
        sellerName: body?.sellerDetails.sellerName,
        sellerGSTIN: body?.sellerDetails.sellerGSTIN,
        sellerAddress: body?.sellerDetails.sellerAddress,
        isSellerAddressAdded: body?.sellerDetails.isSellerAddressAdded,
        sellerPincode: Number(body?.sellerDetails.sellerPincode),
        sellerCity: body?.sellerDetails.sellerCity,
        sellerState: body?.sellerDetails.sellerState,
        sellerPhone: body?.sellerDetails.sellerPhone,
      },
    };

    if (body?.total_order_value > 50000) {
      //@ts-ignore
      data.ewaybill = body?.ewaybill;
    }
    const order2save = new B2COrderModel(data);
    savedOrder = await order2save.save();
    return res.status(200).send({ valid: true, order: savedOrder });
  } catch (error) {

  }
}

export const createBulkB2COrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    if (!req.file || !req.file.buffer) {
      return res.status(400).send({ valid: false, message: "No file uploaded" });
    }

    // Create error workbook early to collect all errors
    const errorWorkbook = new exceljs.Workbook();
    const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');
    errorWorksheet.columns = [
      { header: 'order_reference_id', key: 'order_reference_id', width: 20 },
      { header: 'Error Message', key: 'errors', width: 40 },
    ];
    const errorRows: any = [];

    // Check hub details early to fail fast
    const hubDetails = await HubModel.findOne({ sellerId: req.seller._id, isPrimary: true });
    if (!hubDetails) {
      errorRows.push({
        order_reference_id: "Error",
        errors: "Pickup address doesn't exist. Please enable the Primary Address!"
      });
      errorWorksheet.addRows(errorRows);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');
      await errorWorkbook.csv.write(res);
      return res.end();
    }

    // Get existing orders once
    const existingOrders = await B2COrderModel.find({ sellerId: req.seller._id }, { order_reference_id: 1 }).lean();
    const existingOrderIds = new Set(existingOrders.map(order => order.order_reference_id));

    // Parse CSV to JSON
    const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

    if (json.length < 1) {
      return res.status(200).send({
        valid: false,
        message: "empty payload",
      });
    }

    const today = new Date().toISOString();

    // Transform all orders at once
    const orders = json.map((hub: any) => {
      const isPaymentCOD = hub["payment_mode(COD/Prepaid)"]?.toUpperCase() === "COD" ? 1 : 0;
      const isContainFragileItem = hub["isContainFragileItem(Yes/No)"]?.toUpperCase() === "TRUE" ? true : false;
      return {
        order_reference_id: hub["order_reference_id"],
        pickupAddress: hubDetails._id.toString(),
        productDetails: {
          name: hub["product_desc"],
          category: hub["product_category"] || "Uncategorized",
          quantity: Number(hub["order_quantity"]) ?? 1,
          hsn_code: hub["hsn_code"],
          taxRate: 0,
          taxableValue: Number(parseFloat(hub["order_value"]) ?? 0)
        },
        order_invoice_date: hub["order_invoice_date"] ? convertToISO(hub["order_invoice_date"]) : today,
        order_invoice_number: hub["order_invoice_number"],
        isContainFragileItem: Boolean(isContainFragileItem),
        numberOfBoxes: Number(hub["order_quantity"]) || 1,
        orderBoxHeight: Number(hub["length(cm)"]),
        orderBoxWidth: Number(hub["breadth(cm)"]),
        orderBoxLength: Number(hub["height(cm)"]),
        orderWeight: Number(hub["orderWeight(Kg)"]),
        orderWeightUnit: "kg",
        orderSizeUnit: "cm",
        payment_mode: isPaymentCOD,
        amount2Collect: Number(hub['cod_value']) || 0,
        customerDetails: {
          name: hub['recipient_name'],
          phone: "+91" + hub['recipient_phone'],
          address: hub['recipient_address'],
          pincode: hub['recipient_pincode'],
          city: hub['recipient_city'],
          state: hub['recipient_state']
        },
        sellerDetails: {
          sellerName: hub['seller_name'] ?? req.seller?.name,
          sellerGSTIN: hub['gstin'],
          sellerAddress: hub['seller_address'],
          isSellerAddressAdded: false,
        },
      };
    });

    // Validate all orders first before processing
    const validOrders: any[] = [];
    for (const order of orders) {
      const errors: string[] = [];

      // Check for duplicate order reference IDs in the uploaded batch
      if (validOrders.some(o => o.order_reference_id === order.order_reference_id)) {
        errors.push(`Duplicate order reference ID in the uploaded batch: ${order.order_reference_id}`);
      }

      // Check for existing order reference IDs in the database
      if (existingOrderIds.has(order.order_reference_id)) {
        errors.push(`Order reference ID already exists in the database: ${order.order_reference_id}`);
      }

      const validationResult = validateOrderPayload(order);
      if (!validationResult.valid && validationResult.message) {
        errors.push(validationResult.message);
      }

      if (errors.length > 0) {
        errorRows.push({
          order_reference_id: order.order_reference_id || "Unknown",
          errors: errors.join(", ")
        });
      } else {
        validOrders.push(order);
      }
    }
    
    if (errorRows.length > 0) {
      errorWorksheet.addRows(errorRows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');
      await errorWorkbook.csv.write(res);
      return res.end();
    }

    const BATCH_SIZE = 100; // Adjust based on your system capabilities
    const totalBatches = Math.ceil(validOrders.length / BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, validOrders.length);
      const batchOrders = validOrders.slice(start, end);

      // Create all products for this batch in parallel
      const productPromises = batchOrders.map(order => {
        const { name, category, hsn_code, quantity, taxRate, taxableValue } = order.productDetails;
        const product2save = new ProductModel({
          name,
          category,
          hsn_code,
          quantity,
          tax_rate: taxRate,
          taxable_value: taxableValue,
        });
        return product2save.save();
      });

      const savedProducts = await Promise.all(productPromises);

      const orderDocuments = batchOrders.map((order, index) => {
        return {
          sellerId: req.seller?._id,
          bucket: NEW,
          client_order_reference_id: order?.order_reference_id,
          orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
          pickupAddress: hubDetails?._id,
          productId: savedProducts[index]._id,
          order_reference_id: order?.order_reference_id,
          payment_mode: order?.payment_mode,
          order_invoice_date: order?.order_invoice_date,
          order_invoice_number: order?.order_invoice_number.toString(),
          isContainFragileItem: order?.isContainFragileItem,
          numberOfBoxes: order?.numberOfBoxes,
          orderBoxHeight: order?.orderBoxHeight,
          orderBoxWidth: order?.orderBoxWidth,
          orderBoxLength: order?.orderBoxLength,
          orderSizeUnit: order?.orderSizeUnit,
          orderWeight: order?.orderWeight,
          orderWeightUnit: order?.orderWeightUnit,
          amount2Collect: order?.amount2Collect,
          customerDetails: {
            ...order?.customerDetails,
            // name: body.customerDetails.name//.replace(/[^A-Za-z\s]/g, "")
          },
          sellerDetails: {
            sellerName: order?.sellerDetails.sellerName,
            sellerGSTIN: order?.sellerDetails.sellerGSTIN,
            sellerAddress: order?.sellerDetails.sellerAddress,
          },
        };
      });

      await B2COrderModel.insertMany(orderDocuments);
    }

    return res.status(200).send({
      valid: true,
      message: `Successfully processed ${validOrders.length} orders`
    });

  } catch (error) {
    console.log(error, "error")
    return next(error);
  }
}

export const updateB2COrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    const customerDetails = body?.customerDetails;
    const productDetails = body?.productDetails;

    if (
      !isValidPayload(body, [
        "order_reference_id",
        "orderId",
        "payment_mode",
        "customerDetails",
        "productDetails",
        "pickupAddress",
      ])
    )
      return res.status(200).send({ valid: false, message: "Invalid payload" });

    if (!isValidPayload(productDetails, ["name", "category", "quantity", "taxRate", "taxableValue"]))
      return res.status(200).send({ valid: false, message: "Invalid payload: productDetails" });
    if (!isValidPayload(customerDetails, ["name", "phone", "address", "pincode", "state", "city"]))
      return res.status(200).send({ valid: false, message: "Invalid payload: customerDetails" });
    if (!isValidObjectId(body.pickupAddress))
      return res.status(200).send({ valid: false, message: "Invalid pickupAddress" });


    if (!(body.payment_mode === 0 || body.payment_mode === 1))
      return res.status(200).send({ valid: false, message: "Invalid payment mode" });
    if (body.payment_mode === 1) {
      if (!body?.amount2Collect) {
        return res.status(200).send({ valid: false, message: "Collectable Amount is required" });
      }
    }
    if (body.total_order_value > 50000) {
      if (!isValidPayload(body, ["ewaybill"]))
        return res.status(200).send({ valid: false, message: "Ewaybill required." });
    }

    let orderDetails: any;
    try {
      orderDetails = await B2COrderModel.findOne({
        sellerId: req.seller._id,
        order_reference_id: body?.order_reference_id,
      }).populate(["pickupAddress", "productId"]);;

      if (!orderDetails) {
        const newError = new Error("Order not found.");
        return next(newError);
      }
    } catch (err) {
      return next(err);
    }

    let hubDetails: any;
    try {
      hubDetails = await HubModel.findById(body?.pickupAddress);
      if (!hubDetails) return res.status(200).send({ valid: false, message: "Pickup address doesn't exists" });

    } catch (err) {
      return next(err);
    }

    let savedProduct: any;

    try {
      const { _id, name, category, hsn_code, quantity, taxRate, taxableValue } = productDetails;
      // Find and update the existing product
      savedProduct = await ProductModel.findByIdAndUpdate(_id,
        {
          name,
          category,
          hsn_code,
          quantity,
          tax_rate: taxRate,
          taxable_value: taxableValue,
        });
    } catch (err) {
      return next(err);
    }

    const deliveryDetails = await getPincodeDetails(Number(body.customerDetails.pincode));

    if (!deliveryDetails) throw new Error("Pincode is not serviceable!");

    let savedOrder;

    try {
      const data = {
        sellerId: req.seller?._id,
        bucket: NEW,
        orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
        pickupAddress: body?.pickupAddress,
        productId: savedProduct?._id,
        order_reference_id: body?.order_reference_id,
        payment_mode: body?.payment_mode,
        order_invoice_date: body?.order_invoice_date,
        order_invoice_number: body?.order_invoice_number.toString(),
        isContainFragileItem: body?.isContainFragileItem,
        numberOfBoxes: body?.numberOfBoxes, // if undefined, default=> 0
        orderBoxHeight: body?.orderBoxHeight,
        orderBoxWidth: body?.orderBoxWidth,
        orderBoxLength: body?.orderBoxLength,
        orderSizeUnit: body?.orderSizeUnit,
        orderWeight: body?.orderWeight,
        orderWeightUnit: body?.orderWeightUnit,
        productCount: body?.productCount,
        amount2Collect: body?.amount2Collect,
        customerDetails: {
          ...body?.customerDetails,
          // name: body.customerDetails.name.replace(/[^A-Za-z\s]/g, "")
          name: body.customerDetails.name,
        },
        sellerDetails: {
          sellerName: body?.sellerDetails.sellerName,
          sellerGSTIN: body?.sellerDetails.sellerGSTIN,
          sellerAddress: body?.sellerDetails.sellerAddress,
          isSellerAddressAdded: body?.sellerDetails.isSellerAddressAdded,
          sellerPincode: Number(body?.sellerDetails.sellerPincode),
          sellerCity: body?.sellerDetails.sellerCity,
          sellerState: body?.sellerDetails.sellerState,
          sellerPhone: body?.sellerDetails.sellerPhone,
        },
      };

      if (body?.productDetails.taxableValue > 50000) {
        //@ts-ignore
        data.ewaybill = body?.ewaybill;
      }

      savedOrder = await B2COrderModel.findByIdAndUpdate(body?.orderId, data);


      const shiprocketToken = await getShiprocketToken();
      if (shiprocketToken && orderDetails.shiprocket_order_id) {
        const orderPayload = {
          order_id: orderDetails?.client_order_reference_id,
          order_date: format(body?.order_invoice_date, 'yyyy-MM-dd HH:mm'),
          pickup_location: hubDetails?.name,
          billing_customer_name: body?.customerDetails.name,
          billing_last_name: body?.customerDetails.name || "",
          billing_address: body?.customerDetails.address,
          billing_city: body?.customerDetails.city,
          billing_pincode: body?.customerDetails.pincode,
          billing_state: body?.customerDetails.state,
          billing_country: "India",
          billing_email: body?.customerDetails.email || "noreply@lorrigo.com",
          billing_phone: body?.customerDetails.phone.replace("+91", ""),
          order_items: [
            {
              name: savedProduct.name,
              sku: savedProduct?.category?.slice(0, 40),
              units: 1,
              selling_price: Number(productDetails.taxableValue),
            }
          ],
          payment_method: body?.payment_mode === 0 ? "Prepaid" : "COD",
          sub_total: Number(productDetails.taxableValue),
          length: body.orderBoxLength,
          breadth: body.orderBoxWidth,
          height: body.orderBoxHeight,
          // weight: body?.orderWeight >= 5 ? body?.orderWeight : 0.5,
          weight: body?.orderWeight,
        };

        if (body?.isReverseOrder) {
          Object.assign(orderPayload, {
            pickup_customer_name: body?.customerDetails?.name,
            pickup_phone: body?.customerDetails?.phone.toString()?.slice(2, 12),
            pickup_address: body?.customerDetails?.address,
            pickup_pincode: body?.customerDetails?.pincode,
            pickup_city: body?.customerDetails?.city,
            pickup_state: body?.customerDetails?.state,
            pickup_country: "India",
            shipping_customer_name: hubDetails?.pickupAddress?.name,
            shipping_country: "India",
            shipping_address: hubDetails?.pickupAddress?.address1,
            shipping_pincode: hubDetails?.pickupAddress?.pincode,
            shipping_city: hubDetails?.pickupAddress?.city,
            shipping_state: hubDetails?.pickupAddress?.state,
            shipping_phone: hubDetails?.pickupAddress?.phone.toString()?.slice(2, 12)
          });
        } else {
          Object.assign(orderPayload, {
            shipping_is_billing: true,
            shipping_customer_name: body?.sellerDetails.sellerName || "",
            shipping_last_name: body?.sellerDetails.sellerName || "",
            shipping_address: body?.sellerDetails.sellerAddress,
            shipping_address_2: "",
            shipping_city: body?.sellerDetails.sellerCity,
            shipping_pincode: body?.sellerDetails.sellerPincode,
            shipping_country: "India",
            shipping_state: body?.sellerDetails.sellerState,
            shipping_phone: body?.sellerDetails.sellerPhone,
            ewaybill_no: body?.ewaybill,
          });
        }

        const updateCustomerDetails = {
          order_id: Number(orderDetails?.shiprocket_order_id),
          shipping_customer_name: body?.customerDetails.name,
          shipping_phone: body?.customerDetails.phone.replace("+91", ""),
          shipping_last_name: body?.customerDetails.name || "",
          shipping_address: body?.customerDetails.address,
          shipping_city: body?.customerDetails.city,
          shipping_pincode: Number(body?.customerDetails.pincode),
          shipping_state: body?.customerDetails.state,
          shipping_country: "India",
        }

        try {
          const updateOrderShiprocket = await axios.post(`${envConfig.SHIPROCKET_API_BASEURL}${APIs.SHIPROCKET_UPDATE_ORDER}`, orderPayload, {
            headers: {
              Authorization: `${shiprocketToken}`,
            },
          });
          console.log(updateOrderShiprocket, "updateOrderShiprocket")
          const updateCustomerDetailsShiprocket = await axios.post(`https://apiv2.shiprocket.in/v1/external/orders/address/update`, updateCustomerDetails, {
            headers: {
              Authorization: `${shiprocketToken}`,
            },
          });
          console.log(updateCustomerDetailsShiprocket, 'updateCustomerDetailsShiprocket')
        } catch (error: any) {
          console.log(error.response.data)
        }
      }

      // Find and update the existing order

      return res.status(200).send({ valid: true, order: savedOrder });
    } catch (err) {
      console.log(err)
      return next(err);
    }
  } catch (error) {
    console.log(error)
    return next(error);
  }
};

export const updateBulkPickupOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    const { pickupAddress, orderIds } = body;

    if (!isValidObjectId(pickupAddress))
      return res.status(200).send({ valid: false, message: "Invalid pickupAddress" });
    if (!Array.isArray(orderIds) && !req.query.bulk)
      return res.status(200).send({ valid: false, message: "Invalid orderIds" });

    const hubDetails = await HubModel.findById(pickupAddress);
    if (!hubDetails) return res.status(200).send({ valid: false, message: "Pickup address doesn't exist" });

    let savedOrders: number = 0;
    if (req.query.bulk) {
      const { from, to } = req.query as { from: string, to: string };
      const query: any = { sellerId: req.seller._id, awb: { $exists: false } };

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
      }

      const orders = await B2COrderModel.find(query).select('_id').lean();
      const orderIds = orders.map(order => order._id);

      const bulkUpdateOps = orderIds.map(orderId => ({
        updateOne: {
          filter: { _id: orderId, pickupAddress: { $ne: pickupAddress } },
          update: { pickupAddress }
        }
      }));

      const bulkUpdateResult = await B2COrderModel.bulkWrite(bulkUpdateOps);
      savedOrders = bulkUpdateResult.modifiedCount;
    } else {
      const bulkUpdateOps = orderIds.map((orderId: any) => ({
        updateOne: {
          filter: { _id: orderId },
          update: { pickupAddress }
        }
      }));

      const bulkUpdateResult = await B2COrderModel.bulkWrite(bulkUpdateOps);
      savedOrders = bulkUpdateResult.modifiedCount;
    }

    return res.status(200).send({ valid: true, updatedCount: savedOrders });

  } catch (error) {
    return next(error);
  }
}

export const B2BUpdateBulkPickupOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const { pickupAddress, orderIds } = req.body;

    if (!pickupAddress || !orderIds || !Array.isArray(orderIds)) {
      return res.status(200).send({ valid: false, message: "Invalid payload" });
    }

    if (!isValidObjectId(pickupAddress)) {
      return res.status(200).send({ valid: false, message: "Invalid pickupAddress" });
    }

    const hubDetails = await HubModel.findById(pickupAddress);
    if (!hubDetails) {
      return res.status(200).send({ valid: false, message: "Pickup address doesn't exist" });
    }

    const result = await B2BOrderModel.updateMany(
      { _id: { $in: orderIds } },
      { $set: { pickupAddress } },
      { new: true, multi: true }
    );

    // Check if the update was successful
    if (result.modifiedCount === 0) {
      return res.status(200).send({ valid: false, message: "No orders were updated" });
    }

    return res.status(200).send({ valid: true, message: "Orders updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    return next(error);
  }
};

export const updateB2CBulkShopifyOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {

  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    const {
      orderIds,
      pickupAddressId,
      orderSizeUnit = "cm",
      orderBoxHeight,
      orderBoxWidth,
      orderBoxLength,
      orderWeight,
    } = body;

    if (!Array.isArray(orderIds))
      return res.status(200).send({ valid: false, message: "Invalid orderIds" });

    if (!isValidObjectId(pickupAddressId))
      return res.status(200).send({ valid: false, message: "Invalid pickupAddressId" });

    const bulkUpdateOrder = await B2COrderModel.bulkWrite(
      orderIds.map((orderId: ObjectId) => ({
        updateOne: {
          filter: { _id: orderId },
          update: {
            pickupAddress: pickupAddressId,
            orderSizeUnit,
            orderBoxHeight,
            orderBoxWidth,
            orderBoxLength,
            orderWeight,
          },
        },
      }))
    );

    return res.status(200).send({ valid: true, orders: bulkUpdateOrder });

  } catch (error) {
    return next(error)
  }
}

export const getOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.seller._id;
    let {
      from,
      to,
      status,
      page = 1,
      limit = 20,
      sort = "createdAt",
      order = "desc",
      search,
      statusFilter,
      awb,
      reference,
      isReverse,
      pickupLocation,
      paymentMode,
      bucketStatus
    }: {
      from?: string,
      to?: string,
      status?: string,
      page?: number,
      limit?: number,
      sort?: string,
      statusFilter?: string,
      order?: "asc" | "desc",
      search?: string,
      awb?: string,
      reference?: string,
      isReverse?: string,
      pickupLocation?: string,
      paymentMode?: string,
      bucketStatus?: string
    } = req.query;

    // Convert page and limit to numbers
    const pageNum = Number(page) < 1 ? 1 : Number(page);
    const limitNum = Number(limit) < 1 ? 20 : Number(limit) > 100 ? 100 : Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const bucketMap = {
      new: [NEW, RETURN_CONFIRMED],
      "ready-to-ship": [READY_TO_SHIP, RETURN_PICKED],
      "in-transit": [IN_TRANSIT, RETURN_IN_TRANSIT],
      delivered: [DELIVERED, RETURN_DELIVERED],
      ndr: [NDR, RETURN_CANCELLATION],
      rto: [RTO, RTO_DELIVERED],
    };

    const query: any = { sellerId };

    if (isReverse) {
      query.isReverseOrder = isReverse;
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
    }

    // Status filter (bucket groups)
    if (status && bucketMap.hasOwnProperty(status)) {
      query.bucket = { $in: bucketMap[status as keyof typeof bucketMap] };
    }

    if (bucketStatus && !status) {
      const bucketStatusArray = bucketStatus.split(',').filter(Boolean);
      if (bucketStatusArray.length > 0) {
        query.bucket = { $in: bucketStatusArray };
      }
    }

    if (paymentMode) {
      const paymentModeArray = paymentMode.split(',').filter(Boolean);
      if (paymentModeArray.length > 0) {
        query.payment_mode = { $in: paymentModeArray };
      }
    }

    if (pickupLocation) {
      const pickupLocationArray = pickupLocation.split(',').filter(Boolean);
      if (pickupLocationArray.length > 0) {
        query.pickupAddress = { $in: pickupLocationArray };
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

    if (awb) {
      query.awb = { $regex: awb, $options: 'i' };
    }

    if (reference) {
      query.order_reference_id = { $regex: reference, $options: 'i' };
    }

    if (statusFilter && statusFilter === "unassigned") {
      query.awb = { $exists: false };
    } else if (statusFilter && statusFilter === "assigned") {
      query.awb = { $exists: true, $ne: null };
    }

    const allowedSortFields = ['createdAt', 'order_reference_id', 'awb', 'order_invoice_date', 'bucket', 'payment_mode'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortOptions: any = {};
    sortOptions[sortField] = sortOrder;

    try {
      const totalCount = await B2COrderModel.countDocuments(query);

      const orders = await B2COrderModel
        .find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .select({
          _id: 1,
          awb: 1,
          ewaybill: 1,
          order_reference_id: 1,
          orderItems: 1,
          client_order_reference_id: 1,
          payment_mode: 1,
          orderWeight: 1,
          sellerDetails: 1,
          orderWeightUnit: 1,
          order_invoice_date: 1,
          order_invoice_number: 1,
          numberOfBoxes: 1,
          orderSizeUnit: 1,
          orderBoxHeight: 1,
          orderBoxWidth: 1,
          orderBoxLength: 1,
          amount2Collect: 1,
          customerDetails: 1,
          bucket: 1,
          createdAt: 1,
          updatedAt: 1,
          channelName: 1,
          orderStages: 1,
          isReverseOrder: 1,
          carrierName: 1,
          pickupAddress: 1,
        })
        .populate("productId", "name category quantity taxable_value tax_rate")
        .populate("pickupAddress", "name address city state pincode address1 address2")
        .lean();

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
        },
      });
    } catch (err) {
      return next(err);
    }
  } catch (error) {
    return next(error);
  }
};

export const getChannelOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const seller = req.seller;
    const sellerId = req.seller._id;

    const [shopifyConfig, primaryHub] = await Promise.all([
      getSellerChannelConfig(sellerId),
      HubModel.findOne({ sellerId, isPrimary: true }).lean()
    ]);

    if (!shopifyConfig?.storeUrl || !shopifyConfig?.sharedSecret) {
      return res.status(400).json({ message: "Invalid Shopify configuration." });
    }

    const baseUrl = `${shopifyConfig.storeUrl}${APIs.SHOPIFY_ORDER}`;
    const headers = {
      "X-Shopify-Access-Token": shopifyConfig.sharedSecret,
    };

    let savedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Date range for orders (using last 5 days as default)
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    console.log(startDate, "startDate", endDate, "endDate")

    let nextPageUrl: string | null = `${baseUrl}?limit=250&created_at_min=${startDate}&created_at_max=${endDate}&status=any`;

    while (nextPageUrl) {
      try {
        const response: any = await axios.get(nextPageUrl, {
          headers,
          timeout: 30000 // 30 second timeout
        });

        const orders = response.data.orders || [];

        if (orders.length > 0) {
          console.log(`Processing batch of ${orders.length} orders`);
        } else {
          console.log("No orders in current batch");
          break;
        }

        // Get existing orders to avoid duplicate DB queries
        const orderReferenceIds = orders.map((order: any) => order.name);
        const existingOrders = await B2COrderModel.find({
          sellerId,
          order_reference_id: { $in: orderReferenceIds }
        }).select('order_reference_id').lean();

        const existingOrdersMap: { [key: string]: boolean } = existingOrders.reduce((map, order) => {
          // @ts-ignore
          map[order.order_reference_id as string] = true;
          return map;
        }, {});

        // Prepare bulk operations
        const productsToSave = [];
        const ordersToSave: any[] = [];

        // Process each order
        for (const order of orders) {
          if (existingOrdersMap[order.name]) {
            skippedCount++;
            continue;
          }

          try {
            // Create product
            const product = {
              name: order.line_items?.map((item: any) => item.name).join(", ") || "Unknown Product",
              category: order.line_items?.[0]?.product_type || "Uncategorized",
              quantity: order.line_items?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 1,
              tax_rate: 0,
              taxable_value: parseFloat(order?.total_price || 0),
              sellerId // Add seller ID to product
            };

            productsToSave.push(product);

            // Extract shipping address (prioritize shipping over default)
            const shippingAddress = order.shipping_address || order.customer?.default_address || {};

            // Prepare order with required fields
            const newOrder = {
              sellerId,
              channelOrderId: order.id,
              bucket: NEW,
              channelName: "shopify",
              orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
              order_reference_id: order.name,
              order_invoice_date: order.created_at,
              order_invoice_number: order.name,
              orderWeight: order.total_weight ? order.total_weight / 1000 : 0, // Convert to kg
              orderWeightUnit: "kg",

              // Standard dimensions if not available
              orderBoxHeight: 10,
              orderBoxWidth: 10,
              orderBoxLength: 10,
              orderSizeUnit: "cm",

              client_order_reference_id: order.name,
              payment_mode: order?.financial_status === "pending" ? 1 : 0,
              amount2Collect: order?.financial_status === "pending" ? parseFloat(order?.total_price || 0) : 0,

              customerDetails: {
                name: `${shippingAddress.first_name || order.customer?.first_name || ''} ${shippingAddress.last_name || order.customer?.last_name || ''}`.trim(),
                phone: shippingAddress.phone || order.customer?.phone || '',
                email: order.customer?.email || '',
                address: `${shippingAddress.address1 || ''} ${shippingAddress.address2 || ''}`.trim(),
                pincode: shippingAddress.zip || '',
                city: shippingAddress.city || '',
                state: shippingAddress.province || '',
                country: shippingAddress.country || ''
              },

              sellerDetails: {
                sellerName: seller?.companyProfile?.companyName || seller?.name || '',
                isSellerAddressAdded: !!primaryHub
              },
              orderItems: order.line_items?.map((item: any) => ({
                name: item.name,
                sku: item.sku || '',
                units: item.quantity,
                selling_price: parseFloat(item.price),
                // total: parseFloat(item.price) * item.quantity
              })) || [],

              orderTotal: parseFloat(order.total_price || 0),
              orderSubtotal: parseFloat(order.subtotal_price || 0),
              orderTax: parseFloat(order.total_tax || 0),
              orderCurrency: order.currency,
              orderNotes: order.note || '',
              orderTags: order.tags || '',
              fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
              financialStatus: order.financial_status || 'pending',
              createdAt: new Date(order.created_at),
              updatedAt: new Date(order.updated_at || order.created_at)
            };

            ordersToSave.push(newOrder);
          } catch (err) {
            console.error(`Error processing order ${order.id}:`, err);
            errorCount++;
          }
        }

        // Bulk insert products and get their IDs
        let savedProducts: any = [];
        if (productsToSave.length > 0) {
          savedProducts = await ProductModel.insertMany(productsToSave);
        }

        // Map product IDs to orders and set pickup address
        for (let i = 0; i < ordersToSave.length; i++) {
          ordersToSave[i].productId = savedProducts[i]._id.toString();
          if (primaryHub) {
            ordersToSave[i].pickupAddress = primaryHub._id.toString();
          }
        }

        // Bulk insert orders
        if (ordersToSave.length > 0) {
          await B2COrderModel.insertMany(ordersToSave);
          savedCount += ordersToSave.length;
        }

        // Extract next page URL from Link header
        const linkHeader = response.headers.link || response.headers.Link;
        if (linkHeader) {
          const nextMatch = linkHeader.match(/<(.*?)>; rel="next"/);
          nextPageUrl = nextMatch ? nextMatch[1] : null;
        } else {
          nextPageUrl = null;
        }

        // Brief pause to avoid rate limiting
        if (nextPageUrl) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error: any) {
        console.error("Error fetching or processing batch:", error.response?.data || error.message);
        errorCount++;

        // Handle rate limiting
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] || '10');
          console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue; // Retry the same URL
        }

        break; // Break on other errors
      }
    }

    console.log(`Orders processing complete. Saved: ${savedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);

    return res.status(200).json({
      success: true,
      saved: savedCount,
      skipped: skippedCount,
      errors: errorCount
    });

  } catch (error: any) {
    console.error("Unexpected error in getChannelOrders:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process Shopify orders",
      error: error.message
    });
  }
};

export const createB2BOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body: B2BOrderPayload = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const invoice = files?.invoice?.[0];
    const supporting_document = files?.supporting_document?.[0];

    const boxes = JSON.parse(body?.boxes);

    if (
      !isValidPayload(body, [
        'order_reference_id',
        'client_name',
        'pickupAddress',
        'product_description',
        'total_weight',
        'quantity',
        'ewaybill',
        'amount',
        'invoiceNumber',
        'customerDetails',
        'boxes',
      ])
    ) {
      return res.status(400).send({ valid: false, message: 'Invalid Payload' });
    }
    if (!isValidObjectId(body?.pickupAddress)) {
      return res.status(400).send({ valid: false, message: 'Invalid pickupAddress.' });
    }
    if (!isValidObjectId(body?.customerDetails)) {
      return res.status(400).send({ valid: false, message: 'Invalid customerDetails.' });
    }
    if (!Array.isArray(boxes)) {
      return res.status(400).send({ valid: false, message: 'boxes should be array' });
    }

    const isAlreadyExists = (await B2BOrderModel.findOne({ order_reference_id: body.order_reference_id }).lean()) !== null;
    if (isAlreadyExists) {
      return res.status(400).send({ valid: false, message: 'Order reference id already exists' });
    }

    const data2save = {
      order_reference_id: body?.order_reference_id,
      bucket: NEW,
      client_name: body?.client_name,
      sellerId: req.seller._id,
      freightType: 0,
      pickupType: 0,
      InsuranceType: 0,
      pickupAddress: body?.pickupAddress,
      total_weight: Number(body?.total_weight),
      quantity: Number(body?.quantity),
      ewaybill: body?.ewaybill,
      amount: Number(body?.amount),
      invoiceNumber: body?.invoiceNumber,
      orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
      product_description: body?.product_description,
      packageDetails: boxes,
      customer: body?.customerDetails,
      invoiceImage: invoice ? `/public/${invoice.filename}` : undefined,
      supporting_document: supporting_document ? `/public/${supporting_document.filename}` : undefined,
    };

    try {
      const B2BOrder2Save = new B2BOrderModel(data2save);
      const savedOrder = await B2BOrder2Save.save();

      return res.status(201).send({ valid: true, order: savedOrder });
    } catch (err) {
      return next(err);
    }
  } catch (error) {
    console.log(error, 'error');
    return next(error);
  }
};

export const updateB2BOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const invoice = files?.invoice?.[0];
    const supporting_document = files?.supporting_document?.[0];

    if (
      !isValidPayload(body, [
        'orderId',
        'order_reference_id',
        'client_name',
        'pickupAddress',
        'product_description',
        'total_weight',
        'quantity',
        'ewaybill',
        'amount',
        'invoiceNumber',
        'customerDetails',
        'boxes',
      ])
    ) {
      return res.status(400).send({ valid: false, message: 'Invalid Payload' });
    }

    if (!isValidObjectId(body?.pickupAddress)) {
      return res.status(400).send({ valid: false, message: 'Invalid pickupAddress.' });
    }
    if (!isValidObjectId(body?.customerDetails)) {
      return res.status(400).send({ valid: false, message: 'Invalid customerDetails.' });
    }

    const boxes = JSON.parse(body?.boxes);

    if (!Array.isArray(boxes)) {
      return res.status(400).send({ valid: false, message: 'boxes should be array' });
    }

    const orderDetails = await B2BOrderModel.findById(body.orderId);
    if (!orderDetails) {
      return res.status(404).send({ valid: false, message: 'Order not found' });
    }

    const dataToUpdate = {
      order_reference_id: body?.order_reference_id,
      bucket: NEW,
      client_name: body?.client_name,
      sellerId: req.seller._id,
      freightType: 0,
      pickupType: 0,
      InsuranceType: 0,
      pickupAddress: body?.pickupAddress,
      total_weight: Number(body?.total_weight),
      quantity: Number(body?.quantity),
      ewaybill: body?.ewaybill,
      amount: Number(body?.amount),
      invoiceNumber: body?.invoiceNumber,
      orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
      product_description: body?.product_description,
      packageDetails: boxes,
      customer: body?.customerDetails,
      invoiceImage: invoice ? `/public/${invoice.filename}` : undefined,
      supporting_document: supporting_document ? `/public/${supporting_document.filename}` : undefined,
    };

    try {
      const updatedOrder = await B2BOrderModel.findByIdAndUpdate(body.orderId, dataToUpdate, { new: true });

      return res.status(200).send({ valid: true, order: updatedOrder });
    } catch (err) {
      return next(err);
    }
  } catch (error) {
    console.log(error, 'error');
    return next(error);
  }
};

export const getB2BOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.seller._id;
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

    let orders;
    try {
      let query: any = { sellerId };

      if (status && obj.hasOwnProperty(status)) {
        query.bucket = { $in: obj[status as keyof typeof obj] };
      }

      orders = (await B2BOrderModel
        .find(query)
        .populate("customer")
        .populate("pickupAddress")
        .select("-invoiceImage")
        .lean()).reverse();

    } catch (err) {
      return next(err);
    }
    return res.status(200).send({
      valid: true,
      response: { orders },
    });
  } catch (error) {
    return next(error);
  }
}

export const getB2BCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id;
    const users_vendors = req.seller.b2bVendors
    const order = await B2BOrderModel.findOne({ _id: orderId, sellerId: req.seller._id }).populate(["pickupAddress", "customer"]).select("-__v -updatedAt -createdAt");
    if (!order) return res.status(200).send({ valid: false, message: "Order not found" });

    const orderDetails: OrderDetails = { ...order.toObject() };

    // Rename customer to customerDetails
    orderDetails.customerDetails = orderDetails.customer;
    delete orderDetails.customer;

    // Rename total_weight to orderWeight
    orderDetails.orderWeight = orderDetails.total_weight;
    delete orderDetails.total_weight;

    orderDetails.payment_mode = orderDetails.freightType;
    delete orderDetails.freightType;

    //order_id, mode_id, delivery_partner_id
    const registerOrder = await registerB2BShiprocketOrder(orderDetails, req.seller.name);
    const updateOrder = await B2BOrderModel.findByIdAndUpdate(orderId, { shiprocket_order_id: registerOrder?.order_id, mode_id: registerOrder.mode_id, delivery_partner_id: registerOrder.delivery_partner_id }).select("-__v -updatedAt -createdAt -invoiceImage -supporting_document");;

    const b2bShiprocketServicableOrders = await getB2BShiprocketServicableOrder({
      from_pincode: orderDetails.pickupAddress.pincode,
      from_city: orderDetails.pickupAddress.city,
      from_state: orderDetails.pickupAddress.state,
      to_pincode: orderDetails.customerDetails.pincode,
      to_city: orderDetails.customerDetails.city,
      to_state: orderDetails.customerDetails.state,
      quantity: orderDetails.quantity,
      invoice_value: orderDetails.amount,
      packaging_unit_details: orderDetails.packageDetails.map((packageDetail: any) => ({
        units: packageDetail?.qty || 1,
        length: packageDetail?.orderBoxLength || 0,
        width: packageDetail?.orderBoxWidth || 0,
        height: packageDetail?.orderBoxHeight || 0,
        weight: packageDetail?.orderBoxWeight || 0,
        unit: "cm"
      })),
    },
      users_vendors,
    );

    const mergedArray = [...users_vendors, ...(b2bShiprocketServicableOrders || [])];
    const uniqueCouriers = Array.from(new Set(mergedArray.map((id) => id.toString()))).map(id => id?.toString());

    const data2send = await calculateB2BPriceCouriers(orderId, uniqueCouriers, req.seller._id);
    if (data2send.length < 1) return res.status(200).send({ valid: false, message: "No courier partners found" });
    return res.status(200).send({ valid: true, orderDetails, courierPartner: data2send });
  } catch (error) {
    return next(error);
  }
}

export const getCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id;
    const type = req.params.type;
    const users_vendors = req.seller.vendors
    let data2send: any;
    let orderDetails: any;
    if (type === "b2c") {
      try {
        orderDetails = await B2COrderModel.findOne({ _id: orderId, sellerId: req.seller._id }).populate("pickupAddress productId");
      } catch (err) {
        return next(err);
      }
    }

    const randomInt = Math.round(Math.random() * 20)
    const customClientRefOrderId = orderDetails?.client_order_reference_id + "-" + randomInt;
    const pickupPincode = orderDetails.pickupAddress.pincode;
    const deliveryPincode = orderDetails.customerDetails.get("pincode");
    const order_weight = orderDetails.orderWeight;
    const orderWeightUnit = orderDetails.orderWeightUnit;
    const boxLength = orderDetails.orderBoxLength;
    const boxWeight = orderDetails.orderBoxWidth;
    const boxHeight = orderDetails.orderBoxHeight;
    const sizeUnit = orderDetails.orderSizeUnit;
    const paymentType = orderDetails.payment_mode;
    const sellerId = req.seller._id;
    const collectableAmount = orderDetails?.amount2Collect;
    const volume = orderDetails?.orderBoxLength * orderDetails?.orderBoxWidth * orderDetails?.orderBoxHeight;
    const volumetricWeight = (volume / 5000).toFixed(2);
    const weight = volumetricWeight > order_weight ? volumetricWeight : order_weight;

    const hubId = orderDetails.pickupAddress.hub_id;

    const shiprocketOrderID = await registerOrderOnShiprocket(orderDetails, customClientRefOrderId);

    data2send = await rateCalculation({
      shiprocketOrderID: shiprocketOrderID,
      pickupPincode: pickupPincode,
      deliveryPincode: deliveryPincode,
      weight: weight,
      weightUnit: orderWeightUnit,
      boxLength: boxLength,
      boxWidth: boxWeight,
      boxHeight: boxHeight,
      sizeUnit: sizeUnit,
      paymentType: paymentType,
      users_vendors: users_vendors,
      seller_id: sellerId,
      wantCourierData: false,
      collectableAmount: collectableAmount,
      isReversedOrder: orderDetails.isReverseOrder,
    });

    return res.status(200).send({
      valid: true,
      courierPartner: data2send,
      orderDetails,
    });
  } catch (error: any) {
    console.log(error, "error")
    return next(error);
  }
};

export const getBulkOrdersCourier = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const type = "b2c";
    const users_vendors = req.seller.vendors;
    const orderIds = req.body.orderIds;
    const isBulk = req.query.bulk

    let orderDetails: any[] = [];

    if (isBulk === "true") {
      const couriers = await CourierModel.aggregate([
        {
          $lookup: {
            from: "envs",
            localField: "vendor_channel_id",
            foreignField: "_id",
            as: "vendor_channel"
          }
        },
        { $unwind: "$vendor_channel" },
        {
          $project: {
            nickName: "$vendor_channel.nickName",
            name: 1,
            minWeight: 1,
            isReversedCourier: 1,
            type: 1,
            carrierID: 1
          }
        }
      ]);

      return res.json({ valid: true, courierPartner: couriers });
    }


    if (type === "b2c") {
      try {
        orderDetails = await B2COrderModel.find({ _id: { $in: orderIds }, sellerId: req.seller._id }).populate(["pickupAddress", "productId"]);
      } catch (err) {
        return next(err);
      }
    }

    const results = [];
    let uniqueCourierPartners: any[] = [];


    for (const order of orderDetails) {
      const randomInt = Math.round(Math.random() * 20);
      const customClientRefOrderId = order?.client_order_reference_id + "-" + randomInt;
      const pickupPincode = order.pickupAddress.pincode;
      const deliveryPincode = order.customerDetails.get("pincode");
      const weight = order.orderWeight;
      const orderWeightUnit = order.orderWeightUnit;
      const boxLength = order.orderBoxLength;
      const boxWeight = order.orderBoxWidth;
      const boxHeight = order.orderBoxHeight;
      const sizeUnit = order.orderSizeUnit;
      const paymentType = order.payment_mode;
      const sellerId = req.seller._id;
      const collectableAmount = order?.amount2Collect;
      const hubId = order.pickupAddress.hub_id;


      try {
        const shiprocketOrderID = await registerOrderOnShiprocket(order, customClientRefOrderId);

        let courierPartners = await rateCalculation({
          shiprocketOrderID: shiprocketOrderID,
          pickupPincode: pickupPincode,
          deliveryPincode: deliveryPincode,
          weight: weight,
          weightUnit: orderWeightUnit,
          boxLength: boxLength,
          boxWidth: boxWeight,
          boxHeight: boxHeight,
          sizeUnit: sizeUnit,
          paymentType: paymentType,
          users_vendors: users_vendors,
          seller_id: sellerId,
          wantCourierData: false,
          collectableAmount: collectableAmount,
          isReversedOrder: order.isReverseOrder,
          orderRefId: order.order_reference_id
        });

        uniqueCourierPartners.push(...courierPartners);
        // Filter to get unique courier partners based on carrierID
        // uniqueCourierPartners = [...uniqueCourierPartners, ...courierPartners].reduce((unique, partner) => {
        //   if (!unique.some((item: any) => item?.name === partner?.name)) {
        //     unique.push(partner);
        //   }
        //   return unique;
        // }, []);

      } catch (error) {
        console.error(`Error processing order ${order._id}:`, error);
        // Handle error appropriately, possibly logging or adding to a failed list
      }
    }

    res.json({ valid: true, courierPartner: uniqueCourierPartners });
  } catch (error) {
    next(error);
  }
}

export const getSpecificOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const awb = req.params?.awb;
    const orderId = req.params?.awb;

    // Define search queries based on the presence of awb or orderId
    const queries: Promise<any>[] = [];
    console.log(awb, 'awb')
    if (awb) {
      queries.push(
        B2COrderModel.findOne({ awb }).populate(["pickupAddress", "productId"]).select("-shiprocket_order_id -shiprocket_shipment_id").lean(),
        B2BOrderModel.findOne({ awb }).populate(["pickupAddress", "customer"]).lean()
      );
    }

    if (orderId && isValidObjectId(orderId)) {
      queries.push(
        B2COrderModel.findById(orderId).populate(["pickupAddress", "productId"]).select("-shiprocket_order_id -shiprocket_shipment_id").lean(),
        B2BOrderModel.findById(orderId).populate(["pickupAddress", "customer"]).lean()
      );
    }

    if (queries.length === 0) {
      return res.status(400).send({ valid: false, message: "Missing order identifier." });
    }

    // Execute all queries concurrently
    const [b2cOrderByAwb, b2bOrderByAwb, b2cOrderById, b2bOrderById] = await Promise.all(queries);

    // Check the results
    if (b2cOrderByAwb) {
      return res.status(200).send({ valid: true, order: b2cOrderByAwb });
    }

    if (b2bOrderByAwb) {
      return res.status(200).send({ valid: true, order: b2bOrderByAwb });
    }

    if (b2cOrderById) {
      return res.status(200).send({ valid: true, order: b2cOrderById });
    }

    if (b2bOrderById) {
      return res.status(200).send({ valid: true, order: b2bOrderById });
    }

    // If no order is found in any table
    return res.status(404).send({ valid: false, message: "No such order found." });

  } catch (error) {
    return next(error);
  }
};

export const getOrderInvoiceById = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id;
    const order = await B2BOrderModel.findById(orderId).select("invoiceImage").lean();
    if (!order || !order.invoiceImage) {
      return res.status(404).send({ valid: false, message: "Invoice not found" });
    }
    const pdfBuffer = Buffer.from(order.invoiceImage, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=invoice.pdf');
    return res.send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
};

type PickupAddress = {
  name: string;
  pincode: string;
  city: string;
  state: string;
  address1: string;
  address2?: string;
  phone: number;
  delivery_type_id?: number;
  isSuccess?: boolean;
  code?: number;
  message?: string;
  hub_id?: number;
};

type B2BOrderPayload = {
  // here client_name would be work as client_reference_id
  order_reference_id: string;
  client_name: string;
  freightType: number;
  pickupType: number;
  InsuranceType: number;
  pickupAddress: ObjectId;
  total_weight: number;
  quantity: number;
  ewaybill: string;
  amount: number;
  invoiceNumber: string;
  product_description: string;
  totalOrderValue: number;
  amount2Collect: number;
  shipperGSTIN: string;
  consigneeGSTIN: string;
  packageDetails: any;
  eways: any;
  customerDetails: ObjectId;
  boxes: any;
};
