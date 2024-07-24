import { Router } from "express";
import {
  createB2COrder,
  getOrders,
  createB2BOrder,
  getCourier,
  updateB2COrder,
  getChannelOrders,
  createBulkB2COrder,
  updateBulkPickupOrder,
  updateB2CBulkShopifyOrders,
  getB2BOrders,
  getB2BCourier,
  updateB2BOrder,
  B2BUpdateBulkPickupOrder,
} from "../controllers/order.controller";
import multer from "multer";

const upload = multer();

// ts-ignore is used as contollers request type is extended with custom property seller

const orderRouter = Router();

// @ts-ignore
orderRouter.get("/", getOrders);

// @ts-ignore
orderRouter.get("/b2c/channels", getChannelOrders);

// @ts-ignore
orderRouter.post("/b2c", createB2COrder);

// @ts-ignore
orderRouter.put("/b2c/bulk", upload.single("file"), createBulkB2COrder);

// @ts-ignore
orderRouter.put("/b2c/bulk-pickup", updateBulkPickupOrder);

// @ts-ignore
orderRouter.put("/b2b/bulk-pickup", B2BUpdateBulkPickupOrder);

// @ts-ignore
orderRouter.patch("/update/b2c", updateB2COrder);

// @ts-ignore
orderRouter.patch("/update/b2c/shopify", updateB2CBulkShopifyOrders);

// @ts-ignore
orderRouter.post("/b2b", upload.fields([{ name: 'invoice', maxCount: 1 },{ name: 'supporting_document', maxCount: 1 }]), createB2BOrder);

// @ts-ignore
orderRouter.patch("/update/b2b",  upload.fields([{ name: 'invoice', maxCount: 1 },{ name: 'supporting_document', maxCount: 1 }]),updateB2BOrder);

//@ts-ignore
orderRouter.get("/all/b2b", getB2BOrders);

// @ts-ignore
orderRouter.get("/courier/b2b/:id", getB2BCourier);

// @ts-ignore
orderRouter.get("/courier/:type/:vendorType/:id", getCourier);

export default orderRouter;