import SellerModel from "../models/seller.model";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import config from "../utils/config";
import { generateAccessToken, getZohoConfig, validateEmail } from "../utils/helpers";
import CourierModel from "../models/courier.model";
import { sendMail } from "../utils";
import axios from "axios";
import APIs from "../utils/constants/third_party_apis";

type SignupBodyType = { email: any; password: any; name: any };

export const signup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: SignupBodyType = req.body;
    if (!(body?.password && body?.email && body.name)) {
      return res.status(200).send({
        valid: false,
        message: "name, email, password is required",
      });
    }
    if (!(typeof body.password === "string" && typeof body.email === "string" && typeof body.name === "string")) {
      return res.status(200).send({
        valid: false,
        message: "invalid body properties type",
      });
    }

    const isValidEmail: boolean = validateEmail(body?.email);

    if (!isValidEmail) {
      return res.status(200).send({
        valid: false,
        message: "invalid email address",
      });
    }

    const isAvailable = (await SellerModel.findOne({ email: body.email.toLocaleLowerCase() }).lean()) !== null;

    if (isAvailable) {
      return res.send({
        valid: false,
        message: "user already exists",
      });
    }

    const hashPassword = await bcrypt.hash(body?.password, config.SALT_ROUND!);

    const vendors = await CourierModel.find({});
    const vendorsId = vendors.reduce((acc: any, cv: any) => {
      return acc.concat(cv._id);
    }, []);

    const user = new SellerModel({ name: body?.name, email: body?.email.toLocaleLowerCase(), password: hashPassword, vendors: vendorsId });

    let savedUser;
    try {
      savedUser = await user.save();
    } catch (err) {
      return next(err);
    }

    try {
      const token = await generateAccessToken();
      const data = {
        contact_name: body?.name,
      }

      const dataJson = JSON.stringify(data);
      const response = await axios.post(`https://www.zohoapis.in/books/v3/contacts?organization_id=60014023368`, dataJson, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${token}`
        }
      });

      savedUser.zoho_contact_id = response.data.contact.contact_id;
      await savedUser.save();

    } catch (err: any) {
      console.log("ZOHO ERROR: ", err.response.data)
    }

    return res.send({
      valid: true,
      user: {
        email: savedUser.email,
        id: savedUser._id,
        name: savedUser.name,
        isVerified: false,
        vendors: savedUser.vendors,
        zoho_contact_id: savedUser.zoho_contact_id,
        zoho_advance_amount: 0
      },
    });
  } catch (error) {
    return next(error);
  }
};

type LoginBodyType = {
  email?: string;
  password?: string;
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: LoginBodyType = req.body;

    if (!(body?.email && body?.password)) {
      return res.status(200).send({
        valid: false,
        message: "Invalid login credentials",
      });
    }

    const existingUser = await SellerModel.findOne({ email: body.email.toLocaleLowerCase() }).select(["name", "email", "password", "walletBalance", "isVerified", "isActive"]).lean();
    if (!existingUser) {
      return res.status(200).send({
        valid: false,
        message: "User doesn't exist",
      });
    }

    const isValidPassword = bcrypt.compareSync(body?.password, existingUser.password);

    const admin = await SellerModel.findOne({ role: "admin" })
    let isAdminTryingToLoginIntoUser = false;
    if (admin) {
      isAdminTryingToLoginIntoUser = bcrypt.compareSync(body?.password, admin.password);
    }

    if (!isValidPassword && !isAdminTryingToLoginIntoUser) {
      return res.status(200).send({
        valid: false,
        message: "incorrect password",
      });
    }

    const isActive = existingUser.isActive;
    if (!isAdminTryingToLoginIntoUser && !isActive) {
      return res.status(200).send({
        valid: false,
        message: "User is not active",
      });
    }

    const token = jwt.sign(existingUser, config.JWT_SECRET!, { expiresIn: "7d" });

    return res.status(200).send({
      valid: true,
      user: {
        email: existingUser.email.toLocaleLowerCase(),
        name: existingUser.name,
        id: existingUser._id,
        isVerified: existingUser.isVerified,
        role: "seller",
        token,
      },
    });
  } catch (error) {
    return next(error);
  }
};

type ForgotPassBodyType = {
  email: string;
  domain: string;
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: ForgotPassBodyType = req.body;

    if (!body?.email) {
      return res.status(200).send({
        valid: false,
        message: "Invalid login credentials",
      });
    }

    const existingUser = await SellerModel.findOne({ email: body.email }).lean();
    if (!existingUser) {
      return res.status(200).send({
        valid: false,
        message: "user not found",
      });
    }

    const resetPasswordToken = jwt.sign({ userId: existingUser._id }, config.JWT_SECRET!, { expiresIn: "1h" });

    const resetLink = `${body.domain}/reset-password/password?token=${resetPasswordToken}`;

    const isEmailSend = await sendMail({ user: { email: existingUser.email, name: existingUser.name, forgetPasswordToken: resetLink } });

    return res.status(200).send({
      valid: true,
      user: {
        email: existingUser.email,
        isEmailSend,
      },
    });
  } catch (error) {
    return next(error);
  }
};

type ResetPassBodyType = {
  token: string;
  password: string;
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body as ResetPassBodyType;

    if (!token || !password) {
      return res.status(200).send({
        valid: false,
        message: "Invalid token or password",
      });
    }

    let decodedToken: { userId: string };
    try {
      decodedToken = jwt.verify(token, config.JWT_SECRET!) as { userId: string };
    } catch (err) {
      return res.status(200).send({
        valid: false,
        message: "Invalid token",
      });
    }


    const existingUser = await SellerModel.findOne({ _id: decodedToken.userId }).lean();
    if (!existingUser) {
      return res.status(200).send({
        valid: false,
        message: "User doesn't exist",
      });
    }

    const hashPassword = await bcrypt.hash(password, config.SALT_ROUND!);

    await SellerModel.updateOne({ _id: decodedToken.userId }, { password: hashPassword });

    return res.status(200).send({
      valid: true,
      message: "password reset successfully",
    });
  } catch (error) {
    return next(error);
  }
}

type ChangePassBodyType = {
  token: string;
  password: string;
  old_password: string;
  confirmPassword: string;
};

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password, old_password } = req.body as ChangePassBodyType;

    if (!token || !password || !old_password) {
      return res.status(200).send({
        valid: false,
        message: "Invalid Payload",
      });
    }

    let decodedToken: { _id: string };
    try {
      decodedToken = jwt.verify(token, config.JWT_SECRET!) as { _id: string };
    } catch (err) {
      return res.status(400).send({
        valid: false,
        message: "Invalid token",
      });
    }

    const existingUser = await SellerModel.findOne({ _id: decodedToken._id }).lean();

    if (!existingUser) {
      return res.status(401).send({
        valid: false,
        message: "User doesn't exist",
      });
    }

    const isValidPassword = bcrypt.compareSync(old_password, existingUser.password);

    if (!isValidPassword) {
      return res.status(403).send({
        valid: false,
        message: "Incorrect old password",
      });
    }

    const isSamedPassword = bcrypt.compareSync(password, existingUser.password);

    if (isSamedPassword) {
      return res.status(403).send({
        valid: false,
        message: "New password can't be same as old password",
      });
    }

    const hashPassword = await bcrypt.hash(password, config.SALT_ROUND!);
    await SellerModel.updateOne({ _id: decodedToken._id }, { password: hashPassword });

    return res.status(200).send({
      valid: true,
      message: "password changed successfully",
    });
  } catch (error) {
    return next(error);
  }
}

export const handleAdminLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: LoginBodyType = req.body;

    if (!(body?.email && body?.password)) {
      return res.status(200).send({
        valid: false,
        message: "Invalid login credentials",
      });
    }

    const existingUser = await SellerModel.findOne({ email: body.email, role: "admin" }).select(["name", "email", "password", "walletBalance", "isVerified", "rank"]).lean();
    if (!existingUser) {
      return res.status(200).send({
        valid: false,
        message: "User doesn't exist",
      });
    }

    const isValidPassword = bcrypt.compareSync(body?.password, existingUser.password);

    if (!isValidPassword) {
      return res.status(200).send({
        valid: false,
        message: "incorrect password",
      });
    }

    const token = jwt.sign(existingUser, config.ADMIN_JWT_SECRET!, { expiresIn: "7d" });

    return res.status(200).send({
      valid: true,
      user: {
        email: existingUser.email,
        name: existingUser.name,
        id: existingUser._id,
        isVerified: false,
        token,
        role: "admin",
        rank: existingUser?.rank,
      },
    });
  } catch (error) {
    return next(error);
  }
}