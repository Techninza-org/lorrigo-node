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
    

    shiprocketResponse = await axios.post(
      config.SHIPROCKET_API_BASEURL + APIs.CREATE_PICKUP_LOCATION,
      shiprocketHubPayload,
      shiprocketAPIconfig
    );
    console.log(shiprocketResponse.data, "shiprocketResponse");
  } catch (err) {
    // @ts-ignore
    console.log(err, err?.response?.data?.errors, err?.data, "err");
    return next(err);
  }

  const smartShipData: SMARTSHIP_DATA = smartShipResponse.data;

  let hubId = 0; // if hub_id is not available in smartShipData
  if (smartShipData.status && smartShipData.data.hub_id) {
    hubId = smartShipData.data.hub_id;
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
};

export const getHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const sellerId = req.seller._id;

  let sellerHubs;
  try {
    sellerHubs = await HubModel.find({ sellerId });
  } catch (err) {
    return next(err);
  }
  return res.status(200).send({
    valid: true,
    hubs: sellerHubs,
  });
};

export const getSpecificHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
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
};

export const getCityDetails = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
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
};

// FIXME fix update hub when smartship isnt' login
/*

update-body =>
  hub_name:string,
  hub_phone: number,
  pincode: string,
  city: string,
  state: string,
  address1: string,
  address2: string
  delivery_type_id
*/
export const updateHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const sellerId = req.seller._id;
  const hubId = req.params.id;
  const body = req.body;
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
  let hubData = null;
  try {
    hubData = await HubModel.findOne({ _id: hubId, sellerId }).lean();
  } catch (err) {
    return next(err);
  }
  if (hubData === null) return res.status(200).send({ valid: false, message: "Hub not found" });

  const { hub_id, name, contactPersonName, phone, pincode, city, state, address1, address2, delivery_type_id } = hubData;
  
  try {
    const updatedHub = await HubModel.findOneAndUpdate(
      { _id: hubId, sellerId: sellerId },
      body, 
      { new: true, upsert: true } 
    );

    return res.status(200).send({
      valid: true,
      message: "Hub updated successfully",
      hub: updatedHub,
    });
  } catch (err) {
    return next(err);
  }
  // const smartshipToken = await getSmartShipToken();
  // if (!smartshipToken) return res.status(500).send({ valid: false, message: "SMARTSHIP envs not found" });

  // if (body?.pincode) {
  //   const pincodeDetails = await getPincodeDetails(Number(body?.pincode));
  //   body.city = pincodeDetails?.District;
  //   body.state = pincodeDetails?.StateName;
  // }

  // const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };
  // const smartshipAPIBody = {
  //   hub_id,
  //   hub_name: name,
  //   hub_phone: phone,
  //   contactPersonName, ///
  //   pincode,
  //   city,
  //   state,
  //   address1,
  //   address2,
  //   delivery_type_id,
  //   ...body,
  // };

  // // hit smartship api
  // const response = await axios.put(    //////////////////put ????
  //   config.SMART_SHIP_API_BASEURL + APIs.HUB_UPDATE,
  //   smartshipAPIBody,
  //   smartshipAPIconfig
  // );
  // const smartShipResponseData: SMARTSHIP_UPDATE_DATA = response.data;

  // if (!smartShipResponseData.status) {
  //   return res.status(200).send({
  //     valid: false,
  //     message: "Failed to update",
  //   });
  // }
  // try {
  //   const updatedDocuments = await HubModel.findByIdAndUpdate(
  //     hubData._id,
  //     {
  //       name: smartshipAPIBody.hub_name,
  //       phone: smartshipAPIBody.hub_phone,
  //       pincode: smartshipAPIBody.pincode,
  //       contactPersonName: smartshipAPIBody.contactPersonName,
  //       city: smartshipAPIBody.city,
  //       state: smartshipAPIBody.state,
  //       address1: smartshipAPIBody.address1,
  //       address2: smartshipAPIBody.address2,
  //       delivery_type_id: smartshipAPIBody.delivery_type_id,
  //     },
  //     { new: true }
  //   );

  //   return res.status(200).send({
  //     valid: true,
  //     message: "Hub data updated successfully",
  //     hub: updatedDocuments,
  //   });
  // } catch (err) {
  //   return next(err);
  // }
};

export const deleteHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
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
  const smartshipToken = await getSmartShipToken();
  if (smartshipToken === false) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

  const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };
  const smartshipAPIPayload = { hub_ids: [hubData[0].hub_id] };

  const response = await axios.post(
    config.SMART_SHIP_API_BASEURL + APIs.HUB_DELETE,
    smartshipAPIPayload,
    smartshipAPIconfig
  );
  const smartShipResponseData = response.data;
  Logger.plog(JSON.stringify(smartShipResponseData));
  if (!smartShipResponseData.status) return res.status(200).send({ valid: false, message: "Failed to delete Hub" });
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
  };
  extra: null;
};
