import { Router } from "express";
import { createCustomer, getCustomers } from "../controllers/customer.controller";

const customerRouter = Router();

//@ts-ignore
customerRouter.get("/", getCustomers);
//@ts-ignore
customerRouter.post("/", createCustomer);

export default customerRouter;
