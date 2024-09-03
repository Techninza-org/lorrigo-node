import express from "express";
import apicache from 'apicache';
import type { Request, Response } from "express";
import authRouter from "./routes/auth.routes";
import mongoose from "mongoose";
const app = express();
import config from "./utils/config";
import orderRouter from "./routes/order.routes";
import { AuthMiddleware, ErrorHandler } from "./utils/middleware";
import {
  B2BRatecalculatorController,
  addVendors,
  getSellers,
  ratecalculatorController,
} from "./utils/helpers";
import hubRouter from "./routes/hub.routes";
import cors from "cors";
import customerRouter from "./routes/customer.routes";
import morgan from "morgan";
import shipmentRouter from "./routes/shipment.routes";
import sellerRouter from "./routes/seller.routes";
import runCron, {
  CONNECT_SHIPROCKET,
  CONNECT_SMARTR,
  CONNECT_SMARTSHIP,
} from "./utils/cronjobs";
import Logger from "./utils/logger";
import adminRouter from "./routes/admin.routes";
import { getSpecificOrder } from "./controllers/order.controller";


const cache = apicache.middleware;
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(cache("5 minutes"));

//@ts-ignore
morgan.token("reqbody", (req, res) => JSON.stringify(req.body));
app.use(morgan(":method :url :status - :response-time ms - :reqbody"));

app.get("/ping", (_req, res: Response) => {
  return res.send("pong");
});

if (!config.MONGODB_URI) {
  Logger.log("MONGODB_URI doesn't exists: " + config.MONGODB_URI);
  process.exit(0);
}

async function processChunk() {
  // try {
  //   for (const user of sellers) {
  //     // Find user by email and update their contact_name to ContactId
  //     const updatedUser = await SellerModel.findOneAndUpdate(
  //       { email: user.Email }, // Find condition
  //       { $set: { zoho_contact_id: user.ContactId } }, // Update operation
  //       { new: true } // Return the updated document
  //     );

  //     if (updatedUser) {
  //       console.log(`Updated user: ${updatedUser.email} with contact_name: ${updatedUser.zoho_contact_id}`);
  //     } else {
  //       console.log(`User with email ${user.Email} not found.`);
  //     }
  //   }
  // } catch (error) {
  //   console.log("Error in processChunk[ZOHO]", error);
  // }

}

mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log("db connected successfully");
    CONNECT_SHIPROCKET();
    CONNECT_SMARTSHIP();
    CONNECT_SMARTR();
    // REFRESH_ZOHO_TOKEN();
  })
  .catch((err) => {
    Logger.log(err.message);
  });

app.use("/api/auth", authRouter);
app.post("/api/vendor", addVendors);
app.get("/api/getsellers", getSellers); //admin

// @ts-ignore
app.get("/api/order/:awb", getSpecificOrder);

app.post("/api/shopify", (req, res) => {
  console.log(req.body);
  return res.send("ok");
});

//@ts-ignore
app.post("/api/ratecalculator", AuthMiddleware, ratecalculatorController);
//@ts-ignore
app.post("/api/ratecalculator/b2b", AuthMiddleware, B2BRatecalculatorController);
//@ts-ignore
app.use("/api/seller", AuthMiddleware, sellerRouter);
//@ts-ignore
app.use("/api/customer", AuthMiddleware, customerRouter);
//@ts-ignore
app.use("/api/hub", AuthMiddleware, hubRouter);
//@ts-ignore
app.use("/api/order", AuthMiddleware, orderRouter);
//@ts-ignore
app.use("/api/shipment", AuthMiddleware, shipmentRouter);
//@ts-ignore
app.use("/api/admin", adminRouter);

app.use(ErrorHandler);
app.use("*", (req: Request, res: Response) => {
  return res.status(404).send({
    valid: false,
    message: "invalid route",
  });
});

runCron();

// addAllToZoho();

app.listen(config.PORT, () => Logger.plog("server running on port " + config.PORT));
