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
  getBulkOrdersCourier,
} from "../controllers/order.controller";
import multer from "multer";
import apicache from "apicache";
import path from "path";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// for updload bulk orders only
const Orderstorage = multer.memoryStorage();
const Orderupload = multer({ storage: Orderstorage });

const cache = apicache.middleware;

const orderRouter = Router();

// @ts-ignore
orderRouter.get("/", getOrders);

// @ts-ignore
orderRouter.get("/b2c/channels", cache("2 minutes"), getChannelOrders);

// @ts-ignore
orderRouter.post("/b2c", createB2COrder);

// @ts-ignore
orderRouter.put("/b2c/bulk", Orderupload.single("file"), createBulkB2COrder);

// @ts-ignore
orderRouter.put("/b2c/bulk-pickup", updateBulkPickupOrder);

// @ts-ignore
orderRouter.put("/b2b/bulk-pickup", B2BUpdateBulkPickupOrder);

// @ts-ignore
orderRouter.patch("/update/b2c", updateB2COrder);

// @ts-ignore
orderRouter.patch("/update/b2c/shopify", updateB2CBulkShopifyOrders);

// @ts-ignore
orderRouter.post("/b2b", upload.fields([{ name: 'invoice', maxCount: 1 }, { name: 'supporting_document', maxCount: 1 }]), createB2BOrder);

// @ts-ignore
orderRouter.patch("/update/b2b", upload.fields([{ name: 'invoice', maxCount: 1 }, { name: 'supporting_document', maxCount: 1 }]), updateB2BOrder);

//@ts-ignore
orderRouter.get("/all/b2b", getB2BOrders);

// @ts-ignore
orderRouter.get("/courier/b2b/:id", getB2BCourier);

// @ts-ignore
orderRouter.get("/courier/:type/:vendorType/:id", getCourier);

// @ts-ignore
orderRouter.post("/courier/:type/:vendorType", getBulkOrdersCourier);

export default orderRouter;