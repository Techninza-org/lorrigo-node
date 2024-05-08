import type { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import HubModel from "../models/hub.model";
import { isValidObjectId } from "mongoose";
import axios from "axios";
import config from "../utils/config";
import APIs from "../utils/constants/third_party_apis";
import EnvModel from "../models/env.model";
import {
  getPincodeDetails,
  getShiprocketToken,
  getSmartShipToken,
  isValidPayload,
  validatePhone,
} from "../utils/helpers";
import Logger from "../utils/logger";

// FIXME smartship doesn't expect the hub with same address is the address mateches with some other address hub would not be created.
export const createHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body;

    if (!body) return res.status(200).send({ valid: false, message: "payload required" });

    if (!(body?.name && body?.pincode && body?.address1 && body?.phone)) {
      return res.status(200).send({
        valid: false,
        message: "Invalid payload",
      });
    }

    let { name, pincode, address1, address2, phone, contactPersonName } = req.body;
    pincode = Number(pincode);
    phone = Number(phone);

    if (
      !(
        typeof name === "string" &&
        typeof pincode === "number" &&
        typeof address1 === "string" &&
        typeof phone === "number"
      )
    ) {
      return res.status(200).send({
        valid: false,
        message: "invalid payload type",
      });
    }
    if (!validatePhone(phone)) {
      return res.status(200).send({
        valid: false,
        message: "invalid phone",
      });
    }
    const isAlreadyExists = (await HubModel.findOne({ name, sellerId: req.seller._id }).lean()) !== null;
    // create hub using smartship api
    if (isAlreadyExists) {
      return res.status(200).send({
        valid: false,
        message: `Hub already exists with name: ${name}`,
      });
    }
    const pincodeDetails = await getPincodeDetails(pincode);
    const city = pincodeDetails?.District;
    const state = pincodeDetails?.StateName;

    const smartshipToken = await getSmartShipToken();
    if (!smartshipToken) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

    const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };

    const shiprocketToken = await getShiprocketToken();
    if (!smartshipToken) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

    const shiprocketAPIconfig = { headers: { Authorization: shiprocketToken } };

    const smartshipApiBody = {
      hub_details: {
        hub_name: name,
        pincode: pincode,
        city: city,
        state: state,
        address1: address1,
        address2: address2,
        hub_phone: phone,
        delivery_type_id: 2,
      },
    };

    // console.log(phone.toString().slice(2, 12), "smartshipApiBody");

    const shiprocketHubPayload = {
      pickup_location: name,
      name: name,
      email: "noreply@lorrigo.com",
      phone: phone.toString().slice(2, 12),
      address: address1,
      address_2: address2,
      city: city,
      state: state,
      country: "India",
      pin_code: pincode,
    };

    let smartShipResponse;
    let shiprocketResponse;
    try {
      smartShipResponse = await axios.post(
        config.SMART_SHIP_API_BASEURL! + APIs.HUB_REGISTRATION,
        smartshipApiBody,
        smartshipAPIconfig
      );
      console.log('smartShipResponse', smartShipResponse.data);
    } catch (err) {
      return next(err);
    }

    try {
      shiprocketResponse = await axios.post(
        config.SHIPROCKET_API_BASEURL + APIs.CREATE_PICKUP_LOCATION,
        shiprocketHubPayload,
        shiprocketAPIconfig
      );
      console.log(shiprocketResponse.data, "shiprocketResponse");
    } catch (err) {
      // @ts-ignore
      const isExistingHub = err?.response?.data.errors.pickup_location[0].includes("Address nick name already in use")
      console.log(isExistingHub, "err");
      if (!isExistingHub) return next(err);
    }

    const smartShipData: SMARTSHIP_DATA = smartShipResponse.data;

    let hubId = 0;
    if (smartShipData.status && smartShipData.data.hub_id) {
      hubId = smartShipData.data.hub_id;
    } else if (smartShipData.data.message.registered_hub_id) {
      hubId = Number(smartShipData.data.message.registered_hub_id);
    }

    if (!smartShipData) return res.sendStatus(500);

    const delivery_type_id = 2;

    let savedHub;
    try {
      const toSaveHub = new HubModel({
        sellerId: req.seller._id,
        contactPersonName,
        name,
        city,
        pincode,
        state,
        address1,
        address2,
        phone,

        hub_id: hubId,
        delivery_type_id,
      });
      savedHub = await toSaveHub.save();
    } catch (err) {
      return next(err);
    }

    return res.status(200).send({
      valid: true,
      hub: savedHub,
    });
  } catch (error) {
    console.log("error[CreateHub]", error);
  }
};

export const getHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const sellerId = req.seller._id;

  const { type } = req.query;

  const query = type === "all" ? { sellerId } : { sellerId, isActive: true };

  let sellerHubs;
  try {
    sellerHubs = await HubModel.find(query);
  } catch (err) {
    return next(err);
  }
  return res.status(200).send({
    valid: true,
    hubs: sellerHubs,
  });
};

export const getSpecificHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.seller._id;
    const hubId: string = req.params.id;
    if (!isValidObjectId(sellerId)) {
      return res.status(200).send({
        valid: false,
        message: "invalid sellerId",
      });
    }
    if (!isValidObjectId(hubId)) {
      return res.status(200).send({
        valid: false,
        message: "invalid hubId",
      });
    }

    let specificHub;
    try {
      specificHub = await HubModel.findOne({ sellerId, _id: hubId }).lean();
    } catch (err) {
      return next(err);
    }
    if (specificHub === null) {
      return res.status(200).send({
        valid: false,
        message: "Hub not found",
      });
    } else {
      return res.status(200).send({
        valid: true,
        hub: specificHub,
      });
    }
  } catch (error) {
    return next(error);
  }
};

export const getCityDetails = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const pincode = req.body.pincode;
    if (!pincode) {
      return res.status(200).send({
        valid: false,
        message: "pincode required",
      });
    }
    if (typeof pincode !== "number") {
      return res.status(200).send({
        valid: false,
        message: "invalid pincode",
      });
    }
    const pincodeDetails = await getPincodeDetails(pincode);
    return res.status(200).send({
      valid: true,
      city: pincodeDetails?.District,
      state: pincodeDetails?.StateName,
    });
  } catch (error) {

  }
};

export const updateHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const sellerId = req.seller._id;
    const hubId = req.params.id;
    const body = req.body;
    if (!body) {
      return res.status(200).send({
        valid: false,
        message: "payload required",
      });
    }

    if (!isValidPayload(body, [])) {
      return res.status(200).send({
        valid: false,
        message: "invalid payload",
      });
    }
    if (!isValidObjectId(sellerId)) {
      return res.status(200).send({
        valid: false,
        message: "invalid sellerId",
      });
    }
    if (!isValidObjectId(hubId)) {
      return res.status(200).send({
        valid: false,
        message: "invalid hubId",
      });
    }
    if (body.isActive === undefined) return res.status(200).send({ valid: false, message: "isActive required" });

    const hubData = await HubModel.findOne({ _id: hubId, sellerId: sellerId });
    if (!hubData) return res.status(200).send({ valid: false, message: "hub not found" });


    let updatedHub;
    try {
      updatedHub = await HubModel.findOneAndUpdate(
        { _id: hubId, sellerId: sellerId },
        {
          isActive: body.isActive,
        },
        { new: true }
      );
    } catch (err) {
      return next(err);
    }

    if (!updatedHub) {
      return res.status(200).send({
        valid: false,
        message: "Hub not found",
      });
    }

    return res.status(200).send({
      valid: true,
      message: "Hub updated successfully",
      hub: updatedHub,
    });
  } catch (error) {
    return next(error);
  }

};

export const deleteHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    const hubId = req.params.id;
    const sellerId = req.seller._id;

    let hubData;
    try {
      hubData = await HubModel.find({ _id: hubId, sellerId: sellerId });
    } catch (err) {
      return next(err);
    }
    // console.log(hubData);
    if (hubData.length < 1) return res.status(200).send({ valid: false, message: "hub not found" });

    const env = await EnvModel.findOne({}).lean();
    if (!env) {
      return res.status(500).send({
        valid: false,
        message: "Smartship ENVs not found",
      });
    }

    // const smartshipToken = env.token_type + " " + env.access_token;
    // const smartshipToken = await getSmartShipToken();
    // if (smartshipToken === false) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

    // const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };
    // const smartshipAPIPayload = { hub_ids: [hubData[0].hub_id] };

    // const response = await axios.post(
    //   config.SMART_SHIP_API_BASEURL + APIs.HUB_DELETE,
    //   smartshipAPIPayload,
    //   smartshipAPIconfig
    // );
    // const smartShipResponseData = response.data;
    // Logger.plog(JSON.stringify(smartShipResponseData));
    // if (!smartShipResponseData.status) return res.status(200).send({ valid: false, message: "Failed to delete Hub" });
    try {
      const deletedHub = await HubModel.findByIdAndDelete(hubId);
      return res.status(200).send({
        valid: true,
        message: "Hub deleted successfully",
        hub: deleteHub,
      });
    } catch (err) {
      return next(err);
    }

    return res.status(200).send({
      valid: false,
      message: "incomplete route",
    });
  } catch (error) {
    return next(error)
  }
};

type SMARTSHIP_UPDATE_DATA = {
  status: number;
  code: number;
  message: "OK" | "success" | "invalid_inputs";
  data: {
    message: {
      info: string;
      validation_error?: String[];
    };
  } | null;
  extra: null;
};
type SMARTSHIP_DATA = {
  status: number;
  code: number;
  message: "success" | "OK";
  data: {
    info: string;
    hub_id?: number;
    validation_error?: string[];
    message: { info: string, registered_hub_id: string }
  };
  extra: null;
};
