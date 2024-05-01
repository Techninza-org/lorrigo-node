import { Router } from "express";
import { deleteSeller, getSeller, updateSeller, getRemittaces, getRemittaceByID, uploadKycDocs } from "../controllers/seller.controller";
import { imageStorage } from "../utils/multerConfig";

const sellerRouter = Router();

// console.log(Object.keys(imageStorage))
//@ts-ignore
sellerRouter.put("/",imageStorage.single('logo') ,updateSeller);

//@ts-ignore
sellerRouter.put("/kyc", uploadKycDocs);

//@ts-ignore
sellerRouter.get("/", getSeller);

//@ts-ignore
sellerRouter.delete("/", deleteSeller);

//@ts-ignore
sellerRouter.get("/remittance", getRemittaces);

//@ts-ignore
sellerRouter.get("/remittance/:id", getRemittaceByID);

export default sellerRouter;
