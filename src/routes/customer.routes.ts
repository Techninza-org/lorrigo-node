import { NextFunction, Response, Router } from "express";
import B2BCustomerModel from "../models/customer.model";
import { ExtendedRequest } from "../utils/middleware";
import { createCustomer, getCustomers } from "../controllers/customer.controller";

const customerRouter = Router();

//@ts-ignore
customerRouter.get("/", getCustomers);
//@ts-ignore
customerRouter.post("/", createCustomer);

export default customerRouter;
