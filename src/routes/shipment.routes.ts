import { Router } from "express";
import {
  trackB2BShipment,
  cancelB2BShipment,
  cancelShipment,
  createB2BShipment,
  createShipment,
  getShipmentDetails,
  orderManifest,
  orderReattempt,
  createBulkShipment,
  orderBulkManifest
} from "../controllers/shipment.controller";

const shipmentRouter = Router();

//@ts-ignore
shipmentRouter.post("/", createShipment);

//@ts-ignore
shipmentRouter.post("/bulk", createBulkShipment);

//@ts-ignore
shipmentRouter.post("/b2b", createB2BShipment);

//@ts-ignore
shipmentRouter.post("/cancel", cancelShipment);

//@ts-ignore
shipmentRouter.post("/manifest", orderManifest);

//@ts-ignore
shipmentRouter.post("/bulk-manifest", orderBulkManifest);

//@ts-ignore
shipmentRouter.post("/order-reattempt", orderReattempt);

//@ts-ignore
shipmentRouter.post("/b2b", createB2BShipment);

//@ts-ignore
shipmentRouter.post("/b2b/cancel", cancelB2BShipment); // Not in use

//@ts-ignore
shipmentRouter.get("/b2b/track", trackB2BShipment);

//@ts-ignore
shipmentRouter.get("/dashboard", getShipmentDetails);

export default shipmentRouter;