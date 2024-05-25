import { Router } from "express";
import {
    getAllOrdersAdmin,
    getAllRemittances,
    getSellerDetails,
    getSellerSpecificOrderAdmin,
    getSpecificOrderAdmin,
    updateSellerAdmin,
    uploadPincodes,
    getAllCouriers,
    getSellerCouriers,
    manageSellerCourier,
    getSellerRemittance,
    getFutureRemittances
} from "../controllers/admin.controller";
import { handleAdminLogin } from "../controllers/auth.controller";
import multer from 'multer';
import { AdminAuthMiddleware } from "../utils/middleware";
import { updateVendor4Seller } from "../utils/helpers";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const adminRouter = Router();


adminRouter.post("/login", handleAdminLogin);

//@ts-ignore
adminRouter.get("/all-orders", AdminAuthMiddleware, getAllOrdersAdmin);
//@ts-ignore
adminRouter.get("/order/:id", AdminAuthMiddleware, getSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/orders/seller/:id", AdminAuthMiddleware, getSellerSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/all-remittances", AdminAuthMiddleware, getAllRemittances);

//@ts-ignore
adminRouter.get('/remittances/future', AdminAuthMiddleware, getFutureRemittances);

//@ts-ignore
adminRouter.get("/seller-remittance", AdminAuthMiddleware, getSellerRemittance);

//@ts-ignore
adminRouter.put("/seller", AdminAuthMiddleware, updateSellerAdmin);
//@ts-ignore
adminRouter.get("/seller", AdminAuthMiddleware, getSellerDetails);

//@ts-ignore
adminRouter.get("/couriers", AdminAuthMiddleware, getAllCouriers);

//@ts-ignore
adminRouter.get("/seller-couriers", AdminAuthMiddleware, getSellerCouriers);

//@ts-ignore
adminRouter.post("/update-seller-courier", AdminAuthMiddleware, updateVendor4Seller);

//@ts-ignore
adminRouter.post("/manage-seller-couriers", AdminAuthMiddleware, manageSellerCourier);

//@ts-ignore
adminRouter.put("/pincodes", upload.single('file'), uploadPincodes);


export default adminRouter;