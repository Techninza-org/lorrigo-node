import { NextFunction, Response } from "express";
import { ExtendedRequest } from "../utils/middleware";
import SellerModel from "../models/seller.model";
import RemittanceModel from "../models/remittance-modal";

export const getSeller = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const seller = await req.seller;
    delete seller?.password;
    delete seller?.__v;
    return res.status(200).send({ valid: true, seller });
  } catch (error) {
    return next(error);
  }
};


export const updateSeller = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    let body = req.body;

    const sellerId = req.seller._id;
    try {
      // let logo = req?.file?.buffer.toString('base64');
      // if (logo) {
      //   query = {
      //     ...body,
      //     logo
      //   }
      // }

    } catch (error) {
      console.log(error, "error[Logo error]")
    }

    const updatedSeller = await SellerModel.findByIdAndUpdate(sellerId, { ...body }, { new: true }).select([
      "-__v",
      "-password",
      "-margin",
    ]);

    return res.status(200).send({
      valid: true,
      message: "updated success",
      seller: updatedSeller,
    });
  } catch (err) {
    return next(err);
  }
};

export const uploadKycDocs = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    // if (!req.file) {
    //   return res.status(400).json({ message: 'No file uploaded' });
    // }

    const sellerId = req.seller._id;
    const files = req.files as any;

    const { businessType, gstin, pan, photoUrl, submitted, verified } = req.body;

    const document1Front = files['document1Front'][0].buffer.toString('base64');
    const document1Back = files['document1Back'][0].buffer.toString('base64');
    const document2Front = files['document2Front'][0].buffer.toString('base64');
    const document2Back = files['document2Back'][0].buffer.toString('base64');

    const companyID = `LS${Math.floor(1000 + Math.random() * 9000)}`



    const updatedSeller = await SellerModel.findByIdAndUpdate(
      sellerId,
      {
        $set: {
          kycDetails: {
            businessType,
            gstin,
            pan,
            photoUrl: photoUrl.split(",")[1],
            document1Front,
            document1Back,
            document2Front,
            document2Back,
            submitted,
            verified
          },
          companyProfile: {
            companyId: companyID
          }
        }
      },
      { new: true }
    ).select(["-__v", "-password", "-margin"]);

    return res.status(200).json({
      valid: true,
      message: 'File uploaded successfully',
      seller: updatedSeller,
    });
  } catch (err) {
    console.log(err, "error")
    return next(err);
  }
};


export const deleteSeller = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const seller = req.seller;
  const sellerId = seller._id;

  try {
    const deletedSeller = await SellerModel.findByIdAndDelete(sellerId);
    return res.status(200).send({
      valid: true,
      seller: deletedSeller,
    });
  } catch (err) {
    return next(err);
  }
  return res.status(200).send({
    valid: false,
    message: "incomplete route",
  });
};

export const getRemittaces = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const remittanceOrders = await RemittanceModel.find({ sellerId: req.seller._id });
    if (!remittanceOrders) return res.status(200).send({ valid: false, message: "No Remittance found" });

    return res.status(200).send({
      valid: true,
      remittanceOrders,
    });
  } catch (error) {
    return next(error)
  }
}

export const getRemittaceByID = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const remittanceOrder = await RemittanceModel.findById(req.params.id);
    if (!remittanceOrder) return res.status(200).send({ valid: false, message: "No Remittance found" });

    return res.status(200).send({
      valid: true,
      remittanceOrder,
    });
  } catch (error) {
    return next(error)
  }
}
