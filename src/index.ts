import express from "express";
// import * as dotenv from "dotenv";
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
  calculateSellerInvoiceAmount,
  getDelhiveryToken,
  getDelhiveryToken10,
  getDelhiveryTokenPoint5,
  getSellers,
  ratecalculatorController,
  // updateSellerZohoId,
  updateVendor4Seller,
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
  calculateRemittanceEveryDay,
  trackOrder_Smartr,
} from "./utils/cronjobs";
import Logger from "./utils/logger";
import adminRouter from "./routes/admin.routes";
import PincodeModel from "./models/pincode.model";
import HubModel from "./models/hub.model";
import SellerModel from "./models/seller.model";
import { getSpecificOrder } from "./controllers/order.controller";
import B2BCalcModel from "./models/b2b.calc.model";
import { calculateRateAndPrice, regionToZoneMapping, regionToZoneMappingLowercase } from "./utils/B2B-helper";
import axios from "axios";
import APIs from "./utils/constants/third_party_apis";
import { B2COrderModel } from "./models/order.model";

app.use(cors({ origin: "*" }));

app.use(express.json());

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

// async function toUpdatePinDB() {
//   const updateQuery = {
//     $set: {
//       District: "Delhi"
//     }
//   }
//   const update = await PincodeModel.updateMany({ StateName: "Delhi" }, updateQuery);

// }

// async function toUpdatePrimaryHubDB() {
//   const updateQuery = {
//     $set: {
//       isPrimary: true
//     }
//   }
//   const allSeller = await SellerModel.find();

//   for (let i = 0; i < allSeller.length; i++) {
//     const update = await HubModel.updateOne({ sellerId: allSeller[i]._id.toString() }, updateQuery);
//   }
// }

// async function testData() {
//   const pincodeDelhi = 110085;
//   const pincodeMumbai = 400005;

//   const pincodeDataDelhi = await PincodeModel.findOne({ Pincode: pincodeDelhi }).exec();
//   const pincodeDataMumbai = await PincodeModel.findOne({ Pincode: pincodeMumbai }).exec();

//   if (!pincodeDataDelhi || !pincodeDataMumbai) {
//     throw new Error('Pincode data not found');
//   }

//   const regionNameDelhi = pincodeDataDelhi.District.toLowerCase(); // convert to lowercase
//   const regionNameMumbai = pincodeDataMumbai.District.toLowerCase(); // convert to lowercase

//   const Fzone = regionToZoneMappingLowercase[regionNameDelhi];
//   const Tzone = regionToZoneMappingLowercase[regionNameMumbai];

//   if (!Fzone || !Tzone) {
//     throw new Error('Zone not found for the given region');
//   }

//   const result = await calculateRateAndPrice(Tzone, Fzone, 100, '665ef71c95b70be4d1e5efc7', regionNameDelhi, regionNameMumbai);
//   console.log(`The calculated rate and price is: `);
//   console.log(result);
// }

async function hubRegDelhivery() {
  try {
    const allHub = await HubModel.find();

    const chunkSize = Math.ceil(allHub.length / 4); // Calculate chunk size to divide the array into 4 parts
    const chunks = [];

    for (let i = 0; i < allHub.length; i += chunkSize) {
      chunks.push(allHub.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      await processChunk(chunk);
    }
  } catch (error) {
    console.error("Error fetching hubs:", error);
  }
}

async function processChunk(chunk: any) {
  for (const hub of chunk) {
    const { name, phone, address1, city, pincode, rtoAddress, rtoPincode, rtoCity, rtoState } = hub;
    const delhiveryHubPayload = {
      name: name,
      email: "noreply@lorrigo.com",
      phone: phone.toString().slice(2, 12),
      address: address1,
      city: city,
      country: "India",
      pin: pincode?.toString(),
      return_address: rtoAddress?.toString() || address1,
      return_pin: rtoPincode?.toString() || pincode?.toString(),
      return_city: rtoCity || city,
      return_state: rtoState || "",
      return_country: "India",
    };

    // console.log(delhiveryHubPayload);

    // Uncomment the following block to make the API call
    // try {
    //   const delhiveryToken = await getDelhiveryToken10();
    //   const delhiveryResponse = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
    //     headers: { Authorization: delhiveryToken }
    //   });
    //   console.log(delhiveryResponse.data, "delhivery response");
    // } catch (error: any) {
    //   console.log(error.response?.data, "error in delhivery");
    // }
  }
}

mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log("db connected successfully");
    CONNECT_SHIPROCKET();
    CONNECT_SMARTSHIP();
    CONNECT_SMARTR();
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

// calculateSellerInvoiceAmount();

app.listen(config.PORT, () => Logger.plog("server running on port " + config.PORT));
