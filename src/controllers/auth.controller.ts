import SellerModel from "../models/seller.model";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import config from "../utils/config";
import { validateEmail } from "../utils/helpers";
import CourierModel from "../models/courier.model";
import { sendMail } from "../utils";

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

    const isValidEmail = validateEmail(body?.email);

    if (!isValidEmail) {
      return res.status(200).send({
        valid: false,
        message: "invalid email address",
      });
    }

    const isAvailable = (await SellerModel.findOne({ email: body.email }).lean()) !== null;

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

    const user = new SellerModel({ name: body?.name, email: body?.email, password: hashPassword, vendors: vendorsId });

    let savedUser;
    try {
      savedUser = await user.save();
    } catch (err) {
      return next(err);
    }

    return res.send({
      valid: true,
      user: {
        email: savedUser.email,
        id: savedUser._id,
        name: savedUser.name,
        isVerified: savedUser.isVerified,
        vendors: savedUser.vendors,
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

    const existingUser = await SellerModel.findOne({ email: body.email }).select(["name", "email", "password", "walletBalance", "isVerified"]).lean();
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

    const token = jwt.sign(existingUser, config.JWT_SECRET!, { expiresIn: "7d" });

    return res.status(200).send({
      valid: true,
      user: {
        email: existingUser.email,
        name: existingUser.name,
        id: existingUser._id,
        isVerified: false,
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
        message: "Invalid token or password",
      });
    }

    let decodedToken: { _id: string };
    try {
      decodedToken = jwt.verify(token, config.JWT_SECRET!) as { _id: string };
    } catch (err) {
      return res.status(200).send({
        valid: false,
        message: "Invalid token",
      });
    }

    const existingUser = await SellerModel.findOne({ _id: decodedToken._id }).lean();

    if (!existingUser) {
      return res.status(200).send({
        valid: false,
        message: "User doesn't exist",
      });
    }

    const isValidPassword = bcrypt.compareSync(old_password, existingUser.password);

    if (!isValidPassword) {
      return res.status(200).send({
        valid: false,
        message: "incorrect old password",
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
