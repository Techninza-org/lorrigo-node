import { Router } from "express";
import {
    deleteSeller,
    getSeller,
    updateSeller,
    getRemittaces,
    getRemittaceByID,
    uploadKycDocs,
    manageChannelPartner,
    updateChannelPartner,
    rechargeWalletIntent,
    getSellerBilling,
    confirmRechargeWallet,
    getSellerWalletBalance,
    getSellerTransactionHistory,
    getInvoices,
    getCodPrice,
    getSellerCouriers,
    getInoviceById,
    confirmInvoicePayment,
    payInvoiceIntent,
    refetchLastTransactions,
    raiseDispute,
    getDisputes,
    acceptDisputeBySeller,
    invoiceAwbList,
    getInvoicesFromZoho
} from "../controllers/seller.controller";

import multer from 'multer';
import apicache from 'apicache';

const storage = multer.memoryStorage();
const fileUpload = multer({ storage: storage });

const cache = apicache.options({
    appendKey: (req: any, res) => {
        const endpoint = req.url.split('?')[0];
        const queryParams = JSON.stringify(req.query);
        console.log(`${req}`);
        return `_${endpoint}_${queryParams}`;
    }
}).middleware;


const sellerRouter = Router();

//@ts-ignore
sellerRouter.get("/", getSeller);

//@ts-ignore
sellerRouter.get("/couriers", getSellerCouriers);

//@ts-ignore
sellerRouter.get("/wallet-balance", getSellerWalletBalance);

//@ts-ignore
sellerRouter.get("/transactions", getSellerTransactionHistory);

//@ts-ignore
sellerRouter.get("/invoice", getInvoices) //cache("5 minutes")

//@ts-ignore
sellerRouter.get("/invoices", getInvoicesFromZoho) //, cache("5 minutes")

//@ts-ignore
sellerRouter.get("/invoice/:id", getInoviceById) //, cache("1 day")

//@ts-ignore
sellerRouter.get('/cod-price', getCodPrice)

//@ts-ignore
sellerRouter.get("/remittance", getRemittaces);

//@ts-ignore
sellerRouter.get("/remittance/:id", getRemittaceByID);

//@ts-ignore
sellerRouter.get("/billing", getSellerBilling);  //,cache("50 minutes")

//@ts-ignore
sellerRouter.post("/channels", manageChannelPartner);

//@ts-ignore
sellerRouter.put("/channels/:id", updateChannelPartner);

//@ts-ignore
sellerRouter.put("/", fileUpload.single('file'), updateSeller);

sellerRouter.put("/kyc", fileUpload.fields([
    { name: 'document1Front', maxCount: 1 },
    { name: 'document1Back', maxCount: 1 },
    { name: 'document2Front', maxCount: 1 },
    { name: 'document2Back', maxCount: 1 },
    { name: 'photoUrl', maxCount: 1 }
    //@ts-ignore
]), uploadKycDocs);

//@ts-ignore
sellerRouter.post("/recharge-wallet", rechargeWalletIntent);

//@ts-ignore
sellerRouter.post("/confirm-recharge-wallet", confirmRechargeWallet);

//@ts-ignore
sellerRouter.get("/last-transactions", refetchLastTransactions);

//@ts-ignore
sellerRouter.post("/pay-invoice", payInvoiceIntent);

//@ts-ignore
sellerRouter.post("/confirm-invoice-payment", confirmInvoicePayment);

//@ts-ignore
sellerRouter.delete("/", deleteSeller);

//@ts-ignore
sellerRouter.post("/raise-dispute", raiseDispute)

//@ts-ignore
sellerRouter.get("/disputes", getDisputes)

//@ts-ignore
sellerRouter.post("/disputes/accept", acceptDisputeBySeller)

//@ts-ignore
sellerRouter.get("/invoice-awbs/:id", invoiceAwbList )

export default sellerRouter;