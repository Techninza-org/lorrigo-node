import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel, B2BOrderModel } from "../models/order.model";
import ProductModel from "../models/product.model";
import HubModel from "../models/hub.model";
import { format } from "date-fns";
import {
  getShiprocketToken,
  isValidPayload,
  rateCalculation,
} from "../utils/helpers";
import { isValidObjectId } from "mongoose";
import type { ObjectId } from "mongoose";
import envConfig from "../utils/config";
import axios from "axios";
import APIs from "../utils/constants/third_party_apis";
import { DELIVERED, IN_TRANSIT, NDR, NEW, NEW_ORDER_DESCRIPTION, NEW_ORDER_STATUS, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";

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
        return res.status(200).send({ valid: false, message: "amount2Collect > 0 for COD order" });
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
      bucket: NEW,
      client_order_reference_id: body?.order_reference_id,
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


export const updateB2COrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    // console.log("body", body);
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
        return res.status(200).send({ valid: false, message: "amount2Collect > 0 for COD order" });
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

      if (!orderWithOrderReferenceId) {
        const newError = new Error("Order not found.");
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
      // Find and update the existing order
      savedOrder = await B2COrderModel.findByIdAndUpdate(body?.orderId, data);

      return res.status(200).send({ valid: true, order: savedOrder });
    } catch (err) {
      return next(err);
    }
  } catch (error) {
    return next(error);
  }
};


export const getOrders = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
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

    let orders, orderCount;
    try {
      let query: any = { sellerId };

      if (status && obj.hasOwnProperty(status)) {
        query.bucket = { $in: obj[status as keyof typeof obj] };
      }

      orders = await B2COrderModel
        .find(query)
        .sort({ createdAt: -1 })
        .populate("productId")
        .populate("pickupAddress")
        .lean();

      orderCount =
        status && obj.hasOwnProperty(status)
          ? await B2COrderModel.countDocuments(query)
          : await B2COrderModel.countDocuments({ sellerId });
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

export const createB2BOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body: B2BOrderPayload = req.body;
    if (
      !isValidPayload(body, [
        "client_name",
        "freightType",
        "pickupType",
        "InsuranceType",
        "pickupAddress",
        "invoiceNumber",
        "description",
        "totalOrderValue",
        "amount2Collect",
        "shipperGSTIN",
        "consigneeGSTIN",
        "packageDetails",
        "eways",
        "customerDetails",
      ])
    ) {
      return res.status(200).send({ valid: false, message: "Invalid Payload" });
    }
    if (!isValidObjectId(body?.pickupAddress)) {
      return res.status(200).send({ valid: "Invalid pickupAddress." });
    }
    if (!isValidObjectId(body?.customerDetails)) {
      return res.status(200).send({ valid: "Invalid customerDetails." });
    }
    if (!Array.isArray(body?.packageDetails)) {
      return res.status(200).send({ valid: false, message: "packageDetails should be array" });
    }
    if (!Array.isArray(body?.eways)) {
      return res.status(200).send({ valid: false, message: "eways should be an array" });
    }

    const isAlreadyExists = (await B2BOrderModel.findOne({ client_name: body.client_name }).lean()) !== null;
    if (isAlreadyExists) return res.status(200).send({ valid: false, message: "Client name already exists" });

    const data2save = {
      client_name: body?.client_name,
      sellerId: req.seller._id,
      freightType: body?.freightType, // 0 -> paid, 1 -> toPay
      pickupType: body?.pickupType, // 0 -> FM-Pickup, 1 -> SelfDrop
      InsuranceType: body?.InsuranceType, // 0-> OwnerRisk, 1-> Carrier Risk
      pickupAddress: body?.pickupAddress,
      invoiceNumber: body?.invoiceNumber,
      description: body?.description,
      totalOrderValue: body?.totalOrderValue,
      amount2Collect: body?.amount2Collect,
      gstDetails: {
        shipperGSTIN: body?.shipperGSTIN,
        consigneeGSTIN: body?.consigneeGSTIN,
      },
      packageDetails: [
        ...body.packageDetails,
      ],
      eways: [
        ...body?.eways,
      ],
      customers: [body?.customerDetails],
    };
    try {
      const B2BOrder2Save = new B2BOrderModel(data2save);
      const savedOrder = await B2BOrder2Save.save();
      return res.status(200).send({ valid: true, order: savedOrder });
    } catch (err) {
      return next(err);
    }
    return res.status(500).send({ valid: true, message: "Incomplete route", data2save });
  } catch (error) {
    return next(error);
  }
};

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
    } else {
      return res.status(200).send({ valid: false, message: "Invalid order type" });
      try {
        orderDetails = await B2BOrderModel.findById(productId);
      } catch (err) {
        return next(err);
      }
    }
    const pickupPincode = orderDetails.pickupAddress.pincode;
    const deliveryPincode = orderDetails.customerDetails.get("pincode");
    const weight = orderDetails.orderWeight;
    const orderWeightUnit = orderDetails.orderWeightUnit;
    const boxLength = orderDetails.orderBoxLength;
    const boxWeight = orderDetails.orderBoxWidth;
    const boxHeight = orderDetails.orderBoxHeight;
    const sizeUnit = orderDetails.orderSizeUnit;
    const paymentType = orderDetails.payment_mode;
    const sellerId = req.seller._id;
    const collectableAmount = orderDetails?.amount2Collect;

    const hubId = orderDetails.pickupAddress.hub_id;

    let shiprocketOrder;
    const shiprocketToken = await getShiprocketToken();
    if (!shiprocketToken) return res.status(200).send({ valid: false, message: "Invalid token" });

    console.log("orderDetails", orderDetails?.pickupAddress?.name,)

    const orderPayload = {
      "order_id": orderDetails?.client_order_reference_id,
      "order_date": format(orderDetails?.order_invoice_date, 'yyyy-MM-dd HH:mm'),
      "pickup_location": orderDetails?.pickupAddress?.name,
      // "channel_id": "shopify",
      // "comment": "Reseller: M/s Goku",
      "billing_customer_name": orderDetails?.customerDetails.get("name"),
      "billing_last_name": orderDetails?.customerDetails.get("name") || "",
      "billing_address": orderDetails?.customerDetails.get("address"),
      "billing_city": orderDetails?.customerDetails.get("city"),
      "billing_pincode": orderDetails?.customerDetails.get("pincode"),
      "billing_state": orderDetails?.customerDetails.get("state"),
      "billing_country": "India",
      "billing_email": orderDetails?.customerDetails.get("email") || "noreply@lorrigo.com",
      "billing_phone": orderDetails?.customerDetails.get("phone"),
      "shipping_is_billing": true,
      "shipping_customer_name": orderDetails?.sellerDetails.get("sellerName") || "",
      "shipping_last_name": orderDetails?.sellerDetails.get("sellerName") || "",
      "shipping_address": orderDetails?.sellerDetails.get("sellerAddress"),
      "shipping_address_2": "",
      "shipping_city": orderDetails?.sellerDetails.get("sellerCity"),
      "shipping_pincode": orderDetails?.sellerDetails.get("sellerPincode"),
      "shipping_country": "India",
      "shipping_state": orderDetails?.sellerDetails.get("sellerState"),
      "shipping_email": "",
      "shipping_phone": orderDetails?.sellerDetails.get("sellerPhone"),
      "order_items": [
        {
          "name": orderDetails.productId.name,
          "sku": orderDetails.productId.name,
          "units": orderDetails.productId.quantity,
          "selling_price": Number(orderDetails.productId.taxable_value),
        }
      ],
      "payment_method": orderDetails?.payment_mode === 0 ? "Prepaid" : "COD",
      "sub_total": Number(orderDetails.productId?.taxable_value),
      "length": 20,
      "breadth": 10,
      "height": 10,
      "weight": 0.5,
    };

    try {
      if (!orderDetails.shiprocket_order_id) {
        shiprocketOrder = await axios.post(envConfig.SHIPROCKET_API_BASEURL + APIs.CREATE_SHIPROCKET_ORDER, orderPayload, {
          headers: {
            Authorization: shiprocketToken,
          },
        });
        orderDetails.shiprocket_order_id = shiprocketOrder.data.order_id;
        orderDetails.shiprocket_shipment_id = shiprocketOrder.data.shipment_id;
        await orderDetails.save();
      }
    } catch (error) {
      console.log("error", error);
    }

    const shiprocketOrderID = orderDetails?.shiprocket_order_id ?? 0;

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
    );

    return res.status(200).send({
      valid: true,
      courierPartner: data2send,
      orderDetails,
    });
  } catch (error) {
    return next(error);
  }
};
export const getSpecificOrder = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params?.id;
    if (!isValidObjectId(orderId)) {
      return res.status(200).send({ valid: false, message: "Invalid orderId" });
    }
    //@ts-ignore
    const order = await B2COrderModel.findOne({ _id: orderId, sellerId: req.seller?._id }).populate(["pickupAddress", "productId"]).lean();

    return !order
      ? res.status(200).send({ valid: false, message: "No such order found." })
      : res.status(200).send({ valid: true, order: order });
  } catch (error) {
    return next(error)
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
  client_name: string;
  freightType: number;
  pickupType: number;
  InsuranceType: number;
  pickupAddress: ObjectId;
  invoiceNumber: string;
  description: string;
  totalOrderValue: number;
  amount2Collect: number;
  shipperGSTIN: string;
  consigneeGSTIN: string;
  packageDetails: any;
  eways: any;
  customerDetails: ObjectId;
};
