import { Router } from "express";
import { deleteSeller, getSeller, updateSeller, getRemittaces, getRemittaceByID, uploadKycDocs } from "../controllers/seller.controller";
import { imageStorage } from "../utils/multerConfig";

import multer from 'multer';

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const sellerRouter = Router();

//@ts-ignore
sellerRouter.put("/",imageStorage.single('logo') ,updateSeller);

//@ts-ignore
sellerRouter.put("/kyc", upload.single('file'), uploadKycDocs);

//@ts-ignore
sellerRouter.get("/", getSeller);

//@ts-ignore
sellerRouter.delete("/", deleteSeller);

//@ts-ignore
sellerRouter.get("/remittance", getRemittaces);

//@ts-ignore
sellerRouter.get("/remittance/:id", getRemittaceByID);

export default sellerRouter;
