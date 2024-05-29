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
    confirmRechargeWallet
} from "../controllers/seller.controller";

import multer from 'multer';

const storage = multer.memoryStorage();
const fileUpload = multer({ storage: storage });

const sellerRouter = Router();

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
sellerRouter.get("/", getSeller);

//@ts-ignore
sellerRouter.delete("/", deleteSeller);

//@ts-ignore
sellerRouter.get("/remittance", getRemittaces);

//@ts-ignore
sellerRouter.get("/remittance/:id", getRemittaceByID);

//@ts-ignore
sellerRouter.post("/channels", manageChannelPartner);

//@ts-ignore
sellerRouter.put("/channels/:id", updateChannelPartner);

//@ts-ignore
sellerRouter.get("/billing", getSellerBilling);

//@ts-ignore
sellerRouter.post("/recharge-wallet", rechargeWalletIntent);

//@ts-ignore
sellerRouter.post("/confirm-recharge-wallet", confirmRechargeWallet);


export default sellerRouter;