import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel, B2BOrderModel } from "../models/order.model";
import ProductModel from "../models/product.model";
import HubModel from "../models/hub.model";
import { format, parse } from "date-fns";
import {
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

// TODO create api to delete orders

export const createB2COrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body) return res.status(200).send({ valid: false, message: "Invalid payload" });

    const customerDetails = body?.customerDetails;
    const productDetails = body?.productDetails;

    if (
      !isValidPayload(body, [
        "order_reference_id",
        // "total_order_value",
        "payment_mode",
        "customerDetails",
        "productDetails",
        "pickupAddress",
      ])
    )
      return res.status(200).send({ valid: false, message: "Invalid payload" });

    if (!isValidPayload(productDetails, ["name", "category", "quantity", "taxRate", "taxableValue"]))
      return res.status(200).send({ valid: false, message: "Invalid payload: productDetails" });
    if (!isValidPayload(customerDetails, ["name", "phone", "address", "pincode"]))
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
      customerDetails: body?.customerDetails,
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
    const existingOrders = await B2COrderModel.find({ sellerId: req.seller._id }).lean();
    const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));

    const orders = json.map((hub: any) => {
      const isPaymentCOD = hub["payment_mode(COD/Prepaid)*"]?.toUpperCase() === "COD" ? 1 : 0;
      const isContainFragileItem = hub["isContainFragileItem(Yes/No)*"]?.toUpperCase() === "TRUE" ? true : false;
      return {
        order_reference_id: hub["order_reference_id*"],
        productDetails: {
          name: hub["product_desc*"],
          category: hub["product_category*"],
          quantity: hub["order_quantity*"],
          hsn_code: hub["hsn_code"],
          taxRate: hub["tax_rate*"],
          taxableValue: hub["order_value*"]
        },
        order_invoice_date: hub["order_invoice_date*"],
        order_invoice_number: hub["order_invoice_number*"],
        isContainFragileItem: Boolean(isContainFragileItem),
        numberOfBoxes: hub["order_quantity*"],
        orderBoxHeight: hub["length(cm)*"],
        orderBoxWidth: hub["breadth(cm)*"],
        orderBoxLength: hub["height(cm)*"],
        orderWeight: hub["orderWeight(Kg)*"],
        orderWeightUnit: "kg",
        orderSizeUnit: "cm",
        payment_mode: isPaymentCOD,
        amount2Collect: hub['cod_value*'],
        customerDetails: {
          name: hub['recipient_name*'],
          phone: "+91" + hub['recipient_phone*'],
          address: hub['recipient_address*'],
          pincode: hub['recipient_pincode*'],
          city: hub['recipient_city*'],
          state: hub['recipient_state*']
        },
        sellerDetails: {
          sellerName: hub['seller_name*'],
          sellerGSTIN: hub['gstin'],
          sellerAddress: hub['seller_address'],
        },
      };
    })

    if (orders.length < 1) {
      return res.status(200).send({
        valid: false,
        message: "empty payload",
      });
    }

    try {
      const errorWorkbook = new exceljs.Workbook();
      const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

      errorWorksheet.columns = [
        { header: 'order_reference_id', key: 'order_reference_id', width: 20 },
        { header: 'Error Message', key: 'errors', width: 40 },
      ];

      const errorRows: any = [];

      orders.forEach((order) => {
        const errors: string[] = [];
        Object.entries(order).forEach(([fieldName, value]) => {
          const error = validateBulkOrderField(value, fieldName, orders, existingOrders);
          if (error) {
            errors.push(error);
          }
        });

        if (errors.length > 0) {
          errorRows.push({
            order_reference_id: order.order_reference_id,
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
    } catch (error) {
      return next(error);
    }

    let hubDetails;
    try {
      hubDetails = await HubModel.findOne({ sellerId: req.seller._id, isPrimary: true });
      if (!hubDetails) {
        try {
          const errorWorkbook = new exceljs.Workbook();
          const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

          errorWorksheet.columns = [
            { header: 'order_reference_id', key: 'order_reference_id', width: 20 },
            { header: 'Error Message', key: 'errors', width: 40 },
          ];

          const errorRows: any = [];

          errorRows.push({
            order_reference_id: "Error",
            errors: "Pickup address doesn't exists, Please enable the Primary Address!"
          });


          if (errorRows.length > 0) {
            errorWorksheet.addRows(errorRows);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

            await errorWorkbook.csv.write(res);
            return res.end();
          }
        } catch (error) {
          return next(error);
        }
        return res.status(200).send({ valid: false, message: "Pickup address doesn't exists" });
      }

    } catch (err) {
      return next(err);
    }

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      console.log(order, " order")
      const customerDetails = order?.customerDetails;
      const productDetails = order?.productDetails;

      if (
        !isValidPayload(order, [
          "order_reference_id",
          "payment_mode",
          "customerDetails",
          "productDetails",
        ])
      )
        return res.status(200).send({ valid: false, message: "Invalid payload" });

      if (!isValidPayload(productDetails, ["name", "category", "quantity", "taxRate", "taxableValue"]))
        return res.status(200).send({ valid: false, message: "Invalid payload: productDetails" });
      if (!isValidPayload(customerDetails, ["name", "phone", "address", "pincode"]))
        return res.status(200).send({ valid: false, message: "Invalid payload: customerDetails" });

      if (!(order.payment_mode === 0 || order.payment_mode === 1))
        return res.status(200).send({ valid: false, message: "Invalid payment mode" });
      if (order.payment_mode === 1) {
        if (!order?.amount2Collect) {
          return res.status(200).send({ valid: false, message: "amount2Collect > 0 for COD order" });
        }
      }
      // if (order.total_order_value > 50000) {
      //   if (!isValidPayload(order, ["ewaybill"]))
      //     return res.status(200).send({ valid: false, message: "Ewaybill required." });
      // }

      try {
        const orderWithOrderReferenceId = await B2COrderModel.findOne({
          sellerId: req.seller._id,
          order_reference_id: order?.order_reference_id,
        }).lean();

        if (orderWithOrderReferenceId) {
          const newError = new Error("Order reference Id already exists.");
          return next(newError);
        }
      }
      catch (err) {
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

      let savedOrder;

      const data = {
        sellerId: req.seller?._id,
        bucket: NEW,
        client_order_reference_id: order?.order_reference_id,
        orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
        pickupAddress: hubDetails?._id,
        productId: savedProduct._id,
        order_reference_id: order?.order_reference_id,
        payment_mode: order?.payment_mode,
        order_invoice_date: convertToISO(order?.order_invoice_date),
        order_invoice_number: order?.order_invoice_number.toString(),
        isContainFragileItem: order?.isContainFragileItem,
        numberOfBoxes: order?.numberOfBoxes, // if undefined, default=> 0
        orderBoxHeight: order?.orderBoxHeight,
        orderBoxWidth: order?.orderBoxWidth,
        orderBoxLength: order?.orderBoxLength,
        orderSizeUnit: order?.orderSizeUnit,
        orderWeight: order?.orderWeight,
        orderWeightUnit: order?.orderWeightUnit,
        amount2Collect: order?.amount2Collect,
        customerDetails: order?.customerDetails,
        sellerDetails: {
          sellerName: order?.sellerDetails.sellerName,
          sellerGSTIN: order?.sellerDetails.sellerGSTIN,
          sellerAddress: order?.sellerDetails.sellerAddress,
        },
      };

      // if (order?.total_order_value > 50000) {
      //   //@ts-ignore
      //   data.ewaybill = order?.ewaybill;
      // }
      const order2save = new B2COrderModel(data);
      savedOrder = await order2save.save();
    }
    return res.status(200).send({ valid: true });
  } catch (error) {
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
        customerDetails: body?.customerDetails,
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
          const updateCustomerDetailsShiprocket = await axios.post(`https://apiv2.shiprocket.in/v1/external/orders/address/update`, updateCustomerDetails, {
            headers: {
              Authorization: `${shiprocketToken}`,
            },
          });
          console.log(updateOrderShiprocket.data, 'updateOrderShiprocket')
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
    if (!Array.isArray(orderIds))
      return res.status(200).send({ valid: false, message: "Invalid orderIds" });

    try {
      const hubDetails = await HubModel.findById(pickupAddress);
      if (!hubDetails) return res.status(200).send({ valid: false, message: "Pickup address doesn't exists" });

    } catch (err) {
      return next(err);
    }

    let savedOrders = [];
    for (let i = 0; i < orderIds.length; i++) {
      const orderId = orderIds[i];
      try {
        const order = await B2COrderModel.findByIdAndUpdate(orderId, { pickupAddress });
        savedOrders.push(order);
      }
      catch (err) {
        return next(err);
      }
    }
    return res.status(200).send({ valid: true, orders: savedOrders });

  } catch (error) {
    return next(error)
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
    // let { limit, page, status }: { limit?: number; page?: number; status?: string } = req.query;
    let { from, to, status }: { from?: string, to?: string, status?: string } = req.query;


    const obj = {
      new: [NEW, RETURN_CONFIRMED],
      "ready-to-ship": [READY_TO_SHIP, RETURN_PICKED],
      "in-transit": [IN_TRANSIT, RETURN_IN_TRANSIT],
      delivered: [DELIVERED, RETURN_DELIVERED],
      ndr: [NDR, RETURN_CANCELLATION],
      rto: [RTO, RTO_DELIVERED],
    };

    // limit = Number(limit);
    // page = Number(page);
    // page = page < 1 ? 1 : page;
    // limit = limit < 1 ? 1 : limit;

    // const skip = (page - 1) * limit;

    let orders;
    try {
      let query: any = { sellerId };

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


      if (status && obj.hasOwnProperty(status)) {
        query.bucket = { $in: obj[status as keyof typeof obj] };
      }

      // Optimized query
      orders = await B2COrderModel
        .find(query)
        .sort({ createdAt: -1 })
        .populate("productId", "name category quantity taxable_value tax_rate") // Fetch only required fields from productId
        .populate("pickupAddress")    // Fetch only required fields from pickupAddress
        .lean();

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
};

export const getChannelOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const seller = req.seller;
    const sellerId = req.seller._id;
    const shopfiyConfig = await getSellerChannelConfig(sellerId);
    const primaryHub = await HubModel.findOne({ sellerId, isPrimary: true });

    const shopifyOrders = await axios.get(`${shopfiyConfig?.storeUrl}${APIs.SHOPIFY_ORDER}`, {
      headers: {
        "X-Shopify-Access-Token": shopfiyConfig?.sharedSecret,
      },
    });
    const orders = shopifyOrders.data.orders;

    
    for (let i = orders.length - 1; i >= 0; i--) {
      const order = orders[i];
      console.log(JSON.stringify(order, null, 2), "orders[orders.length - 1]")
      const orderDetails = await B2COrderModel.findOne({ sellerId, order_reference_id: order.name }).lean();
      if (!orderDetails) {

        const product2save = new ProductModel({
          name: order.line_items?.map((item: any) => item.name).join(", "),
          category: order.line_items?.map((item: any) => item.name).join(", "),
          quantity: order.line_items?.reduce((acc: number, item: any) => acc + item.quantity, 0),
          tax_rate: 0,
          taxable_value: order?.total_price,
        });

        await product2save.save()

        const newOrder = new B2COrderModel({
          sellerId,
          channelOrderId: order.id,
          bucket: NEW,
          channelName: "shopify",
          orderStages: [{ stage: NEW_ORDER_STATUS, stageDateTime: new Date(), action: NEW_ORDER_DESCRIPTION }],
          order_reference_id: order?.name || 'SHOPIFY-' + Math.round(Math.random() * 10000),
          order_invoice_date: order.created_at,
          order_invoice_number: order.name,
          orderWeight: order?.line_items?.reduce((acc: number, item: any) => acc + item.grams / 1000, 0),
          orderWeightUnit: "kg",

          // hard coded values
          orderBoxHeight: 10,
          orderBoxWidth: 10,
          orderBoxLength: 10,
          orderSizeUnit: "cm",

          client_order_reference_id: order.name || 'SHOPIFY-' + Math.round(Math.random() * 10000),
          payment_mode: order?.financial_status === "pending" ? 1 : 0,  // 0 -> prepaid, 1 -> COD, Right now only prepaid, bcoz data not available
          amount2Collect: order?.financial_status === "pending" ? order?.total_price : 0,
          customerDetails: {
            name: order.customer.first_name + " " + order.customer.last_name,
            phone: order?.customer?.default_address?.phone,
            email: order?.customer?.email,
            address: (order?.customer?.default_address?.address1 + order?.customer?.default_address?.address2),
            pincode: order?.customer?.default_address?.zip,
            city: order?.customer?.default_address?.city,
            state: order?.customer?.default_address?.province,
          },
          sellerDetails: {
            sellerName: seller?.companyProfile?.companyName || seller?.name,
            isSellerAddressAdded: false,
            // sellerAddress: order?.billing_address?.address1 || primaryHub?.address1,
            // sellerCity: order?.billing_address?.city,
            // sellerState: order?.billing_address?.province,
            // sellerPincode: 0,
            // sellerPhone: order?.billing_address?.phone,
          },
          productId: product2save._id.toString(),
          pickupAddress: primaryHub?._id.toString(),
        });

        await newOrder.save();
      }
    }

    return res.status(200).send({ valid: true });
  } catch (error) {
    console.log("error", error)
    return next(error);
  }
}

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
    const productId = req.params.id;
    const type = req.params.type;
    const users_vendors = req.seller.vendors
    let data2send: any;
    let orderDetails: any;
    if (type === "b2c") {
      try {
        orderDetails = await B2COrderModel.findOne({ _id: productId, sellerId: req.seller._id }).populate(["pickupAddress", "productId"]);
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

    data2send = await rateCalculation(
      shiprocketOrderID,
      pickupPincode,
      deliveryPincode,
      weight,
      orderWeightUnit,
      boxLength,
      boxWeight,
      boxHeight,
      sizeUnit,
      paymentType,
      users_vendors,
      sellerId,
      collectableAmount,
      hubId,

      orderDetails.isReverseOrder,
    );

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

    let orderDetails: any[] = [];

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

        let courierPartners = await rateCalculation(
          shiprocketOrderID,
          pickupPincode,
          deliveryPincode,
          weight,
          orderWeightUnit,
          boxLength,
          boxWeight,
          boxHeight,
          sizeUnit,
          paymentType,
          users_vendors,
          sellerId,
          collectableAmount,
          hubId,
          order.isReverseOrder,
          order.order_reference_id
        );

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

    if (awb) {
      queries.push(
        B2COrderModel.findOne({ awb }).populate(["pickupAddress", "productId"]).lean(),
        B2BOrderModel.findOne({ awb }).populate(["pickupAddress", "customer"]).lean()
      );
    }

    if (orderId && isValidObjectId(orderId)) {
      queries.push(
        B2COrderModel.findById(orderId).populate(["pickupAddress", "productId"]).lean(),
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
