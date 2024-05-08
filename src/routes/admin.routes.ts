import { Router } from "express";
import { getAllOrdersAdmin, getAllRemittances, getSellerDetails, getSellerSpecificOrderAdmin, getSpecificOrderAdmin, updateSellerAdmin, uploadPincodes } from "../controllers/admin.controller";
import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const adminRouter = Router();

//@ts-ignore
adminRouter.get("/all-orders", getAllOrdersAdmin);
//@ts-ignore
adminRouter.get("/order/:id", getSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/orders/seller/:id", getSellerSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/all-remittances", getAllRemittances);
//@ts-ignore
adminRouter.put("/seller", updateSellerAdmin);
//@ts-ignore
adminRouter.get("/seller", getSellerDetails);

//@ts-ignore
adminRouter.put("/pincodes", upload.single('file'), uploadPincodes);

export default adminRouter;