import type { Response, NextFunction } from "express";
import type { ExtendedRequest } from "../utils/middleware";
import HubModel from "../models/hub.model";
import { isValidObjectId } from "mongoose";
import axios from "axios";
import config from "../utils/config";
import APIs from "../utils/constants/third_party_apis";
import EnvModel from "../models/env.model";
import {
  getDelhiveryToken,
  getDelhiveryToken10,
  getDelhiveryTokenPoint5,
  getPincodeDetails,
  getShiprocketToken,
  getSmartShipToken,
  isValidPayload,
  validatePhone,
} from "../utils/helpers";
import csvtojson from "csvtojson";
import exceljs from "exceljs";
import { validateField } from "../utils";

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

    let {
      name,
      pincode,
      address1,
      address2,
      phone,
      contactPersonName,
      isRTOAddressSame,
      rtoAddress,
      rtoCity,
      rtoState,
      rtoPincode
    } = req.body;

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

    const smartshipApiBodySurface = {
      hub_details: {
        hub_name: name,
        pincode: pincode,
        city: city,
        state: state,
        address1: address1,
        address2: address2,
        hub_phone: phone,
        delivery_type_id: 2,  // 1 for express, 2 for surface
      },
    };
    const smartshipApiBodyExpress = {
      hub_details: {
        hub_name: name,
        pincode: pincode,
        city: city,
        state: state,
        address1: address1,
        address2: address2,
        hub_phone: phone,
        delivery_type_id: 1,  // 1 for express, 2 for surface
      },
    };

    const shiprocketHubPayload = {
      pickup_location: name,
      name: name,
      email: "noreply@lorrigo.com",
      phone: phone.toString().slice(2, 12),
      address: address1,
      address_2: "",
      city: city,
      state: state,
      country: "India",
      pin_code: pincode,
    };

    const delhiveryHubPayload = {
      name: name,
      email: "noreply@lorrigo.com",
      phone: phone.toString().slice(2, 12),
      address: address1,
      city: city,
      country: "India",
      pin: pincode?.toString(),
      return_address: rtoAddress?.toString() || address1,
      return_pin: rtoPincode?.toString() || pincode?.toString(),
      return_city: rtoCity || city,
      return_state: rtoState,
      return_country: "India"
    }

    let smartShipResponse;
    let smartShipResponseExpress;
    let shiprocketResponse;
    try {
      smartShipResponse = await axios.post(
        config.SMART_SHIP_API_BASEURL! + APIs.HUB_REGISTRATION,
        smartshipApiBodySurface,
        smartshipAPIconfig
      );
      smartShipResponseExpress = await axios.post(
        config.SMART_SHIP_API_BASEURL! + APIs.HUB_REGISTRATION,
        smartshipApiBodyExpress,
        smartshipAPIconfig
      );

      console.log(smartShipResponseExpress.data, "smartship express response")

    } catch (err) {
      return next(err);
    }

    try {
      shiprocketResponse = await axios.post(
        config.SHIPROCKET_API_BASEURL + APIs.CREATE_PICKUP_LOCATION,
        shiprocketHubPayload,
        shiprocketAPIconfig
      );
    } catch (err: any) {
      console.log(err)
      const isExistingHub = err?.response?.data?.errors?.pickup_location?.[0].includes("Address nick name already in use")
      if (!isExistingHub) return next(err);
    }

    try {
      const delhiveryToken5 = await getDelhiveryToken();
      const delhiveryTokenPoint5 = await getDelhiveryTokenPoint5();
      const delhiveryToken10 = await getDelhiveryToken10();
      const delhiveryResponse5 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
        headers: { Authorization: delhiveryToken5 }
      });
      const delhiveryResponsePoint5 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
        headers: { Authorization: delhiveryTokenPoint5 }
      });
      const delhiveryResponse10 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
        headers: { Authorization: delhiveryToken10 }
      });
    } catch (error: any) {
      console.log(error.response?.data, "error in delhivery")
      return res.status(500).send({ valid: false, error });
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
        isRTOAddressSame,
        rtoAddress,
        rtoCity,
        rtoState,
        rtoPincode,

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

export const bulkHubUpload = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send({ valid: false, message: "No file uploaded" });
    }

    const alreadyExistingHubs = await HubModel.find({ sellerId: req.seller._id }).select(["name"]);
    const json = await csvtojson().fromString(req.file.buffer.toString('utf8'));


    const hubs = json.map((hub: any) => {
      const isRTOAddressSame = hub["IsRTOAddressSame*"]?.toUpperCase() === "TRUE";
      return {
        name: hub["FacilityName*"],
        email: hub["Email*"],
        pincode: hub["Pincode*"],
        city: hub['City*'],
        state: hub["State*"],
        address1: hub["Address1*"],
        address2: hub["Address2*"],
        phone: "91" + hub["PickupLocationContact*"],
        contactPersonName: hub["ContactPersonName*"],
        isRTOAddressSame: Boolean(isRTOAddressSame),
        rtoAddress: hub["RTOAddress*"],
        rtoCity: hub["RTOCity*"],
        rtoState: hub["RTOState*"],
        rtoPincode: hub["RTOPincode*"],
      };
    })

    if (hubs.length < 1) {
      return res.status(200).send({
        valid: false,
        message: "empty payload",
      });
    }

    try {
      const errorWorkbook = new exceljs.Workbook();
      const errorWorksheet = errorWorkbook.addWorksheet('Error Sheet');

      errorWorksheet.columns = [
        { header: 'FacilityName', key: 'name', width: 20 },
        { header: 'Email', key: 'email', width: 20 },
        { header: 'Error Message', key: 'errors', width: 40 },
      ];

      const errorRows: any = [];

      hubs.forEach((hub) => {
        const errors: string[] = [];
        Object.entries(hub).forEach(([fieldName, value]) => {
          const error = validateField(value, fieldName, hubs, alreadyExistingHubs);
          if (error) {
            errors.push(error);
          }
        });

        if (errors.length > 0) {
          errorRows.push({
            name: hub.name,
            email: hub.email,
            pincode: hub.pincode,
            errors: errors.join(", ")
          });
        }
      });

      if (errorRows.length > 0) {
        errorWorksheet.addRows(errorRows);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=error_report.csv');

        await errorWorkbook.csv.write(res);
        return res.end();
      }

    } catch (error) {
      return next(error);
    }

    const smartshipToken = await getSmartShipToken();
    if (!smartshipToken) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

    const smartshipAPIconfig = { headers: { Authorization: smartshipToken } };

    const shiprocketToken = await getShiprocketToken();
    if (!smartshipToken) return res.status(200).send({ valid: false, message: "smartship ENVs not found" });

    const shiprocketAPIconfig = { headers: { Authorization: shiprocketToken } };

    const savedHubs = [];
    for (let i = 0; i < hubs.length; i++) {

      const hub = hubs[i];
      let savedHub;

      let smartShipResponse;
      let shiprocketResponse;
      try {
        const smartshipApiBody = {
          hub_details: {
            hub_name: hub.name,
            pincode: hub.pincode,
            city: hub.city,
            state: hub.state,
            address1: hub.address1,
            address2: hub.address2,
            hub_phone: hub.phone.toString().slice(2, 12),
            delivery_type_id: 2,
          },
        };
        smartShipResponse = await axios.post(
          config.SMART_SHIP_API_BASEURL! + APIs.HUB_REGISTRATION,
          smartshipApiBody,
          smartshipAPIconfig
        );
      } catch (err) {
        return next(err);
      }

      try {
        const shiprocketPayload = {
          pickup_location: hub.name,
          name: hub.name,
          email: "noreply@lorrigo.com",
          phone: hub.phone.toString().slice(2, 12),
          address: hub.address1,
          address_2: hub.address2,
          city: hub.city,
          state: hub.state,
          country: "India",
          pin_code: hub.pincode,
        }
        shiprocketResponse = await axios.post(
          config.SHIPROCKET_API_BASEURL + APIs.CREATE_PICKUP_LOCATION,
          shiprocketPayload,
          shiprocketAPIconfig
        );
      } catch (err) {
        console.log(err);
        return next(err);
      }

      const delhiveryHubPayload = {
        name: hub.name,
        email: "noreply@lorrigo.com",
        phone: hub.phone.toString().slice(2, 12),
        address: hub.address1,
        city: hub.city,
        country: "India",
        pin: hub.pincode?.toString(),
        return_address: hub.rtoAddress?.toString() || hub.address1,
        return_pin: hub.rtoPincode?.toString() || hub.pincode?.toString(),
        return_city: hub.rtoCity || hub.city,
        return_state: hub.rtoState,
        return_country: "India"
      }

      try {
        const delhiveryToken5 = await getDelhiveryToken();
        const delhiveryTokenPoint5 = await getDelhiveryTokenPoint5();
        const delhiveryToken10 = await getDelhiveryToken10();
        const delhiveryResponse5 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
          headers: { Authorization: delhiveryToken5 }
        });
        const delhiveryResponsePoint5 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
          headers: { Authorization: delhiveryTokenPoint5 }
        });
        const delhiveryResponse10 = await axios.post(config.DELHIVERY_API_BASEURL + APIs.DELHIVERY_PICKUP_LOCATION, delhiveryHubPayload, {
          headers: { Authorization: delhiveryToken10 }
        });
      } catch (error: any) {
        console.log(error.response?.data, "error in delhivery")
        return res.status(500).send({ valid: false, error });
      }

      const smartShipData: SMARTSHIP_DATA = smartShipResponse.data;

      let hubId = 0;
      if (smartShipData.status && smartShipData.data.hub_id) {
        hubId = smartShipData.data.hub_id || 0;
      } else if (smartShipData.data.message.registered_hub_id) {
        hubId = Number(smartShipData.data.message.registered_hub_id);
      }

      try {
        const toSaveHub = new HubModel({
          sellerId: req.seller._id,
          contactPersonName: hub.contactPersonName,
          name: hub.name,
          city: hub.city,
          pincode: hub.pincode,
          state: hub.state,
          address1: hub.address1,
          address2: hub.address2,
          phone: hub.phone,
          isRTOAddressSame: hub.isRTOAddressSame,
          rtoAddress: hub.rtoAddress,
          rtoCity: hub.rtoCity,
          rtoState: hub.rtoState,
          rtoPincode: hub.rtoPincode,
          hub_id: hubId,
          delivery_type_id: 2,
        });
        savedHub = await toSaveHub.save();
      } catch (err) {
        return next(err);
      }
      savedHubs.push(savedHub);
    }

    return res.status(200).send({
      valid: true,
      hubs: savedHubs,
    });
  } catch (error) {
    return next(error);
  }
}

export const getHub = async (req: ExtendedRequest, res: Response, next: NextFunction) => {
  const sellerId = req.seller._id;

  const { type } = req.query;

  const query = type === "all" ? { sellerId } : { sellerId, isActive: true };

  let sellerHubs: any[] = [];
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
      return res.status(400).send({
        valid: false,
        message: "Payload required",
      });
    }

    if (!isValidPayload(body, [])) {
      return res.status(400).send({
        valid: false,
        message: "Invalid payload",
      });
    }

    if (!isValidObjectId(sellerId) || !isValidObjectId(hubId)) {
      return res.status(400).send({
        valid: false,
        message: "Invalid sellerId or hubId",
      });
    }

    const sellerHubs = await HubModel.find({ sellerId });

    const activeHubs = sellerHubs.filter((hub) => hub.isActive === true);
    const primaryHubs = sellerHubs.filter((hub) => hub.isPrimary === true);

    if (activeHubs.length === 0) {
      return res.status(400).send({
        valid: false,
        message: "At least one hub should be active",
      });
    }

    if (body.isPrimary && !body.isActive) {
      return res.status(400).send({
        valid: false,
        message: "Only active hub can become primary",
      });
    }

    if (body.isPrimary && primaryHubs.length > 0 && primaryHubs[0]._id.toString() !== hubId) {
      await HubModel.findByIdAndUpdate(primaryHubs[0]._id, { isPrimary: false });
    }

    if (!body.isPrimary && primaryHubs.length === 1 && primaryHubs[0]._id.toString() === hubId) {
      return res.status(400).send({
        valid: false,
        message: "Cannot make the primary hub inactive",
      });
    }

    if (body.isPrimary && primaryHubs.length > 1) {
      return res.status(400).send({
        valid: false,
        message: "Only one hub can be primary",
      });
    }

    if (!body.isActive && activeHubs.length === 1 && activeHubs[0]._id.toString() === hubId) {
      return res.status(400).send({
        valid: false,
        message: "Cannot make the last active hub inactive",
      });
    }

    // Update the hub
    let updatedHub;
    try {
      updatedHub = await HubModel.findOneAndUpdate(
        { _id: hubId, sellerId: sellerId },
        {
          isActive: body.isActive,
          isPrimary: body.isPrimary,
        },
        { new: true }
      );
    } catch (err) {
      return next(err);
    }

    return res.status(200).send({
      valid: true,
      message: "Hub updated successfully",
      updatedHub: updatedHub,
    });

  } catch (error) {
    next(error);
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
