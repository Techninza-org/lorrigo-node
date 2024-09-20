import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import config from "./config";
import SellerModel from "../models/seller.model";
import Logger from "./logger";

export type ExtendedRequest = Request & {
  seller: any;
  admin: any;
};

export const AuthMiddleware = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers?.authorization;

    if (!token) {
      return res.status(200).send({
        valid: false,
        message: "token is required",
      });
    }

    const splittedToken = token.split(" ");
    if (splittedToken[0] !== "Bearer") {
      return res.status(200).send({
        valid: false,
        message: "invalid token_type",
      });
    }

    let decryptedToken: any;
    try {
      decryptedToken = jwt.verify(splittedToken[1], config.JWT_SECRET!);
    } catch (err: any) {
      return next(err);
    }

    // extracting seller using token and seller model
    const sellerEmail = decryptedToken?.email;
    if (!sellerEmail) {
      Logger.log("Error: token doens't contain email, ", sellerEmail);
      const err = new Error("Error: token doens't contain email");
      return next(err);
    }

    const seller = await SellerModel.findOne({ email: sellerEmail })
      .select('_id vendors gstno b2bVendors walletBalance channelPartners name config')
      .populate({
        path: 'channelPartners',  // Specify the field to populate
        select: '_id name',       // Select only the necessary fields from channelPartners
      });

    if (!seller) {
      return res.status(200).send({ valid: false, message: "Seller no more exists" });
    }
    req.seller = seller;
    next();
  } catch (error) {
    console.log(error, 'error[AuthMiddleware]');
  }
};
export const AdminAuthMiddleware = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers?.authorization;

    if (!token) {
      return res.status(200).send({
        valid: false,
        message: "token is required",
      });
    }

    const splittedToken = token.split(" ");
    if (splittedToken[0] !== "Bearer") {
      return res.status(200).send({
        valid: false,
        message: "invalid token_type",
      });
    }

    let decryptedToken: any;
    try {
      decryptedToken = jwt.verify(splittedToken[1], config.ADMIN_JWT_SECRET!);
    } catch (err: any) {
      return next(err);
    }

    // extracting seller using token and seller model
    const sellerEmail = decryptedToken?.email;
    if (!sellerEmail) {
      Logger.log("Error: token doens't contain email, ", sellerEmail);
      const err = new Error("Error: token doens't contain email");
      return next(err);
    }

    const seller = await SellerModel.findOne({ email: sellerEmail,  role: "admin"  }).select('_id');

    if (!seller) return res.status(200).send({ valid: false, message: "Admin no more exists" });
    req.admin = seller;
    next();
  } catch (error) {
    console.log(error, 'error[AuthMiddleware]');
  }
};



export const ErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    if (err.name === "JsonWebTokenError") {
      return res.status(200).send({
        valid: false,
        message: "Invalid JWT token",
      });
    } else if (err.name === "TokenExpiredError") {
      return res.status(200).send({
        valid: false,
        message: "Token expired",
      });
    } else if (err.name === "CastError") {
      return res.status(200).send({
        valid: false,
        message: "Invalid Id",
      });
    }

    Logger.log(err);
    
    // Handle specific 400 and 401 status codes
    // @ts-ignore
    const message = err?.response?.status === 400 || err?.response?.status === 401
    ? "Sorry, something went wrong"
    // @ts-ignore
    : err?.response?.data?.message ?? err?.message ?? "Something went wrong";
    
    // @ts-ignore
    return res.status(err?.response?.status ?? 400).send({
      valid: false,
      message,
    });
  } else {
    return res.status(400).send({
      valid: false,
      message: "Sorry, something went wrong",
    });
  }
};