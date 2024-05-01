import { Router } from "express";
import {
  createB2COrder,
  getOrders,
  createB2BOrder,
  getCourier,
  getSpecificOrder,
  updateB2COrder
} from "../controllers/order.controller";

// ts-ignore is used as contollers request type is extended with custom property seller

const orderRouter = Router();

// @ts-ignore
orderRouter.get("/", getOrders);

// @ts-ignore
orderRouter.get("/:id", getSpecificOrder);


// @ts-ignore
orderRouter.post("/b2c", createB2COrder);

// @ts-ignore
orderRouter.patch("/update/b2c", updateB2COrder);

// @ts-ignore
orderRouter.post("/b2b", createB2BOrder);

// @ts-ignore
orderRouter.get("/courier/:type/:vendorType/:id", getCourier);
export default orderRouter;
