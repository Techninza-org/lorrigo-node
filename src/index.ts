import express from "express";
import type { Request, Response } from "express";
import authRouter from "./routes/auth.routes";
import mongoose from "mongoose";
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
import runCron from "./utils/cronjobs";
import Logger from "./utils/logger";
import adminRouter from "./routes/admin.routes";
import { getSpecificOrder } from "./controllers/order.controller";
import apicache from "apicache";
import path from "path";
import PaymentTransactionModal from "./models/payment.transaction.modal";
import SellerModel from "./models/seller.model";
import RemittanceModel from "./models/remittance-modal";


const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const cache = apicache.middleware;

app.use('/api/public', express.static(path.join(__dirname, 'public')));
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

// async function revertRevisedMoneyNTxnToday() {
//   const today = new Date();
//   today.setHours(0, 0, 0, 0);
//   const threeDaysAgo = new Date(today);
//   threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
//   const tomorrow = new Date(today);
//   tomorrow.setDate(tomorrow.getDate() + 1);

//   const revisedTxn = await PaymentTransactionModal.find({
//     createdAt: {
//       $gte: threeDaysAgo,
//       $lt: today,
//     },
//     desc: { $regex: "Revised" }
//   });

//   console.log(revisedTxn.length, "revisedTxn")

//   for (const txn of revisedTxn) {
//     const seller = await SellerModel.findById(txn.sellerId);
//     console.log(seller?.name, txn.amount);
//     if (seller) {
//       seller.walletBalance += Number(txn.amount);
//       await seller.save();

//       const deletedTxn = await PaymentTransactionModal.findByIdAndDelete(txn._id);
//       console.log(deletedTxn);
//     }
//   }
// }

// revertRevisedMoneyNTxnToday()


mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log("db connected successfully");
  })
  .catch((err) => {
    Logger.log(err.message);
  });

app.use("/api/auth", authRouter);
app.post("/api/vendor", addVendors);
app.get("/api/getsellers", cache("5 minutes"), getSellers); //admin

// @ts-ignore
app.get("/api/order/:awb", getSpecificOrder);

app.post("/api/shopify", (req, res) => {
  console.log(req.body);
  return res.send("ok");
});

//@ts-ignore
// app.get("/api/invoice/:id", getOrderInvoiceById);
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

app.listen(config.PORT, () => Logger.plog("server running on port " + config.PORT));
