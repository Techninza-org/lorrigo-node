import express from "express";
import type { Request, Response } from "express";
import authRouter from "./routes/auth.routes";
import mongoose from "mongoose";
const app = express();
import config from "./utils/config";
import orderRouter from "./routes/order.routes";
import { AuthMiddleware, ErrorHandler, ExtendedRequest } from "./utils/middleware";
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
import { getOrderInvoiceById, getSpecificOrder } from "./controllers/order.controller";
import apicache from "apicache";
import path from "path";
import RegionToZone from "./models/RegionToZone.modal";
import axios from "axios";
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

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


// async function downloadPDF(url: any, path: any) {
//   try {
//     const response = await axios({
//       url,
//       method: 'GET',
//       responseType: 'stream',
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
//                       'AppleWebKit/537.36 (KHTML, like Gecko) ' +
//                       'Chrome/58.0.3029.110 Safari/537.3',
//         'Accept': 'application/pdf,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
//         'Referer': 'https://www.orimi.com/',
//         'Accept-Encoding': 'gzip, deflate, br',
//         'Connection': 'keep-alive'
//     }});

//     return new Promise((resolve, reject) => {
//       const writer = fs.createWriteStream(path);
//       response.data.pipe(writer);

//       writer.on('finish', resolve);
//       writer.on('error', reject);
//     });
//   } catch (error) {
//     console.error('Error downloading PDF');
//     throw error;
//   }
// }

// // Function to remove a line (or detect it) in a PDF
// async function removeLineFromPDF(inputPath: any, searchText: any, outputPath: any) {
//   // Load the existing PDF
//   const existingPdfBytes = fs.readFileSync(inputPath);
//   const pdfDoc = await PDFDocument.load(existingPdfBytes);

//   // Get all the pages
//   const pages = pdfDoc.getPages();
//   let foundText = false;

//   // Loop through all pages and detect the text
//   for (const page of pages) {
//     const textContent = page.getTextContent(); // Note: This won't give direct text extraction
//     // pdf-lib doesn't support direct text extraction, so you would need a library like `pdf-parse` for accurate text extraction
//     // But we can manipulate the page in other ways
//     // Here, we'll just search for the term and notify
//     if (textContent.includes(searchText)) {
//       foundText = true;
//       console.log(`Found text "${searchText}" on page ${page.getIndex() + 1}`);
//       // You can't remove it directly with pdf-lib, but you could redact the area or create a new PDF with the content you want.
//     }
//   }

//   if (foundText) {
//     console.log(`"${searchText}" was found in the PDF.`);
//   } else {
//     console.log(`"${searchText}" was NOT found in the PDF.`);
//   }

//   // Write the updated PDF to the output path
//   const pdfBytes = await pdfDoc.save();
//   fs.writeFileSync(outputPath, pdfBytes);

//   console.log('PDF processing complete.');
// }

// const url = 'https://s28.q4cdn.com/392171258/files/doc_downloads/test.pdf';
// const downloadPath = './sample.pdf';
// const outputPath = './output.pdf';

// // Download and then process the PDF
// downloadPDF(url, downloadPath)
//   .then(() => {
//     console.log('PDF ');
//     return removeLineFromPDF(downloadPath, 'This', outputPath);
//   })
//   .then(() => {
//     console.log('PDF line removal process completed.');
//   })
//   .catch((err: any) => {
//     console.error('Error:', err);
//   });

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
