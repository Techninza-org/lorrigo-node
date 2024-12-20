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
    getFutureRemittances,
    uploadClientBillingCSV,
    getClientBillingData,
    manageSellerRemittance,
    getVendorBillingData,
    getInvoices,
    getSellerB2BCouriers,
    manageB2BSellerCourier,
    updateB2BVendor4Seller,
    updateSellerConfig,
    walletDeduction,
    getInoviceById,
    generateInvoices,
    getAllUserWalletTransaction,
    uploadB2BClientBillingCSV,
    getSubAdmins,
    updateSubadminPaths,
    deleteSubadmin,
    getDisputes,
    acceptDispute,
    rejectDispute,
    getDisputeById,
    uploadDisputeCSV,
    getAllInvoices
} from "../controllers/admin.controller";
import { handleAdminLogin } from "../controllers/auth.controller";
import multer from 'multer';
import apicache from 'apicache';
import { AdminAuthMiddleware } from "../utils/middleware";
import { updateVendor4Seller } from "../utils/helpers";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const adminRouter = Router();

const cache = apicache.options({
    appendKey: (req: any, res) => {
        const endpoint = req.url.split('?')[0];
        const queryParams = JSON.stringify(req.query);
        return `${req?.seller?._id?.toString()}_${endpoint}_${queryParams}`;
    }
}).middleware;


adminRouter.post("/login", handleAdminLogin);

//@ts-ignore
adminRouter.get("/all-orders", AdminAuthMiddleware, cache("2 minutes"), getAllOrdersAdmin);

//@ts-ignore
adminRouter.get("/all-wallet", AdminAuthMiddleware, cache("2 minutes"), getAllUserWalletTransaction);

//@ts-ignore
adminRouter.get("/order/:id", AdminAuthMiddleware, cache("10 minutes"), getSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/orders/seller/:id", AdminAuthMiddleware, cache("10 minutes"), getSellerSpecificOrderAdmin);
//@ts-ignore
adminRouter.get("/all-remittances", AdminAuthMiddleware, getAllRemittances);

//@ts-ignore
adminRouter.get('/remittances/future', AdminAuthMiddleware, getFutureRemittances);

//@ts-ignore
adminRouter.get("/seller-remittance", AdminAuthMiddleware, getSellerRemittance);

//@ts-ignore
adminRouter.put("/seller", AdminAuthMiddleware, updateSellerAdmin);

//@ts-ignore
adminRouter.put("/seller/config/:sellerId", updateSellerConfig);

//@ts-ignore
adminRouter.get("/seller", AdminAuthMiddleware, getSellerDetails);

//@ts-ignore
adminRouter.get("/couriers", AdminAuthMiddleware, getAllCouriers);

//@ts-ignore
adminRouter.post("/wallet-deduction", AdminAuthMiddleware, walletDeduction);

// B2C
//@ts-ignore
adminRouter.get("/seller-couriers", AdminAuthMiddleware, getSellerCouriers);

//@ts-ignore
adminRouter.post("/update-seller-courier", AdminAuthMiddleware, updateVendor4Seller);

//@ts-ignore
adminRouter.post("/manage-seller-couriers", AdminAuthMiddleware, manageSellerCourier);

// B2B
//@ts-ignore
adminRouter.get("/seller-b2b-couriers", AdminAuthMiddleware, getSellerB2BCouriers);

// B2B
//@ts-ignore
adminRouter.post("/update-seller-b2b-courier", AdminAuthMiddleware, updateB2BVendor4Seller);

// B2B
//@ts-ignore
adminRouter.post("/manage-seller-b2b-couriers", AdminAuthMiddleware, manageB2BSellerCourier);

//@ts-ignore
adminRouter.put("/pincodes", upload.single('file'), uploadPincodes);

//@ts-ignore
adminRouter.put("/billing/client-billing/upload-csv", AdminAuthMiddleware, upload.single('file'), uploadClientBillingCSV);

//@ts-ignore
adminRouter.put("/billing/b2b/client-billing/upload-csv", AdminAuthMiddleware, upload.single('file'), uploadB2BClientBillingCSV);

//@ts-ignore
adminRouter.put("/dispute/upload-csv", AdminAuthMiddleware, upload.single('file'), uploadDisputeCSV);

//@ts-ignore
adminRouter.get("/billing/vendor", AdminAuthMiddleware, cache("3 minutes"), getVendorBillingData);

//@ts-ignore
adminRouter.get("/billing/client", AdminAuthMiddleware, getClientBillingData);

//@ts-ignore
adminRouter.post("/manage-remittance", AdminAuthMiddleware, manageSellerRemittance);

//@ts-ignore
adminRouter.get("/invoice", AdminAuthMiddleware, cache("1 day"), getInvoices);

//@ts-ignore
adminRouter.get("/invoice/:id", AdminAuthMiddleware, cache("1 day"), getInoviceById);

// @ts-ignore
adminRouter.get('/generate-invoice', AdminAuthMiddleware, cache("1 day"), generateInvoices);

//@ts-ignore
adminRouter.get('/subadmins', AdminAuthMiddleware, getSubAdmins)

//@ts-ignore
adminRouter.put("/subadmins/:id", AdminAuthMiddleware, updateSubadminPaths);

//@ts-ignore
adminRouter.delete("/subadmins/delete/:id", AdminAuthMiddleware, deleteSubadmin)

//@ts-ignore
adminRouter.get("/disputes", AdminAuthMiddleware, getDisputes)

//@ts-ignore
adminRouter.get("/disputes/:id", AdminAuthMiddleware, getDisputeById)

//@ts-ignore
adminRouter.post("/disputes/accept", AdminAuthMiddleware, acceptDispute)

//@ts-ignore
adminRouter.post("/disputes/reject", AdminAuthMiddleware, rejectDispute)

//@ts-ignore
adminRouter.get("/invoices", AdminAuthMiddleware, getAllInvoices)

export default adminRouter;