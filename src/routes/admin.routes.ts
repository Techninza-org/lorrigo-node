import { Router } from "express";
import { getAllOrdersAdmin, getSpecificOrderAdmin } from "../controllers/admin.controller";

const adminRouter = Router();

//@ts-ignore
adminRouter.get("/all-orders", getAllOrdersAdmin);
//@ts-ignore
adminRouter.get("/:id", getSpecificOrderAdmin);

export default adminRouter;