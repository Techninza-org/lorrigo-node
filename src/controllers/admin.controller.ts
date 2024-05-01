import { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import { B2COrderModel } from "../models/order.model";
import { DELIVERED, IN_TRANSIT, NDR, NEW, NEW_ORDER_DESCRIPTION, NEW_ORDER_STATUS, READY_TO_SHIP, RTO } from "../utils/lorrigo-bucketing-info";
import { isValidObjectId } from "mongoose";

export const getAllOrdersAdmin = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
    let { limit, page , status }: { limit?: number; page?: number; status?: string } = req.query;
  
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
      let query: any = { };
  
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
          : await B2COrderModel.countDocuments({ });
    } catch (err) {
      return next(err);
    }
    return res.status(200).send({
      valid: true,
      response: { orders, orderCount },
    });
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