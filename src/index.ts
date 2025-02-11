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
  refundExtraInvoiceAmount,
  // reverseExtraRtoCodfor31,
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
import ClientBillingModal from "./models/client.billing.modal";

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

// RTO
// $regex: /(RTO charges|~RTO charges|RTO-charges|RTO Charge Applied)$/i
// $regex: `(AWB: ${awbNumber}|${awbNumber}).*(RTO charges|~RTO charges|RTO-charges|RTO Charge Applied)`,

// Cod 
// $regex: /(~RTO COD charges|COD Charge Reversed|COD Refund)$/i
// $regex: `(AWB: ${awbNumber}|${awbNumber}).*(~RTO COD charges|COD Charge Reversed|COD Refund)`,

// async function revertRevisedMoneyNTxnToday() {
//   try {
//     const rtoChargeAppliedTxns = await PaymentTransactionModal.find({
//       desc: {
//         $regex: /(~FW Excess Charge|FW Excess Charge|FW Excess Charge)$/i
//       },
//     }).sort({ createdAt: -1 });

//     for (const txn of rtoChargeAppliedTxns) {
//       const awbMatch = txn.desc.match(/(?:AWB: )?(\d+)/);
//       if (!awbMatch) continue;

//       const awbNumber = awbMatch[1];

//       const duplicateRtoTxns = await PaymentTransactionModal.find({
//         desc: {
//           $regex: `(AWB: ${awbNumber}|${awbNumber}).*(~FW Excess Charge|FW Excess Charge|FW Excess Charge)`,
//           $options: 'i'
//         },
//         sellerId: txn.sellerId
//       });

//       if (duplicateRtoTxns.length > 0) {
//         // console.log(`Duplicate RTO Transactions Found for AWB: ${awbNumber}`, duplicateRtoTxns);

//         // Sort transactions by createdAt (latest first)
//         // @ts-ignore
//         duplicateRtoTxns.sort((a, b) => b.createdAt - a.createdAt);

//         // Keep one transaction (oldest), delete others
//         const transactionToKeep = duplicateRtoTxns[0];
//         const transactionsToDelete = duplicateRtoTxns.slice(1);

//         // Calculate total refund amount (excluding the one we keep)
//         const totalRefundAmount = transactionsToDelete.reduce((sum, dTxn) => sum + Number(dTxn.amount), 0);
//         if (totalRefundAmount <= 0) return;

//         // console.log(`Total Refund Amount for AWB ${awbNumber}: ₹${totalRefundAmount}`);

//         // Fetch seller details
//         const seller = await SellerModel.findById(txn.sellerId);
//         // if (seller) {
//         //   // Refund the total amount once
//         //   seller.walletBalance += totalRefundAmount;  // - to duduct and + to add *********Be very carefull with + or - sign********* once the operation done txn will lose
//         //   await seller.save();

//         //   // Remove all duplicate transactions except one
//         //   await PaymentTransactionModal.deleteMany({
//         //     _id: { $in: transactionsToDelete.map(dTxn => dTxn._id) }
//         //   });

//         //   console.log(`Reverted ₹${totalRefundAmount} to seller ${seller._id} ${seller.name} and removed ${transactionsToDelete.length} duplicate transactions.`);
//         // }
//       }
//     }

//     console.log("Reversion Process Completed.");
//   } catch (error) {
//     console.error("Error in revertRevisedMoneyNTxnToday:", error);
//   }
// }

// Excess
// async function excessChargeRefundForMansiOnly() {

//   const revisedTxn = await PaymentTransactionModal.find({
//     sellerId: "66791386cfe0c278957805af",
//     desc: { $regex: " RTO Excess Charge" }
//   });
//   console.log(revisedTxn.length)

//   const totalRefundAmount = revisedTxn.reduce((sum, dTxn) => sum + Number(dTxn.amount), 0);
//   const allTxnIds = revisedTxn.map(txn => txn._id);
//   const seller = await SellerModel.findById("66791386cfe0c278957805af");

//   if (seller) {
//     seller.walletBalance += Number(totalRefundAmount); // - to duduct and + to add
//     await seller.save();

//     await PaymentTransactionModal.deleteMany({
//       _id: { $in: allTxnIds }
//     });
//   }

//   console.log("Reversion Process Completed.");
// }

// async function update() {
//   const filterCondition = {
//     zoneChangeCharge: { $gt: 0 },
//   };

//   // Define the update operation
//   const updateOperation = { disputeRaisedBySystem: false };

//   // const result = await ClientBillingModal.find({ zoneChangeCharge: { $gt: 0 }, sellerId: "66791386cfe0c278957805af" })
//   // Perform the update
//   const result = await ClientBillingModal.updateMany(filterCondition, updateOperation);
//   console.log(result, "result")
// }


mongoose
  .connect(config.MONGODB_URI)
  .then(() => {
    console.log("db connected successfully");
  })
  .catch((err) => {
    console.log(err.message);
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

// refundExtraInvoiceAmount();
// reverseExtraRtoCodfor31();

runCron();

app.listen(config.PORT, () => Logger.plog("server running on port " + config.PORT));
