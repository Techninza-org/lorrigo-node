import { Router } from "express";
import multer from 'multer';
import { createHub, deleteHub, getHub, getSpecificHub, updateHub, getCityDetails, bulkHubUpload } from "../controllers/hub.controller";

const upload = multer();

const hubRouter = Router();

// @ts-ignore
hubRouter.post("/", createHub);

// @ts-ignore
hubRouter.put("/bulk-hub-upload", upload.single('file'), bulkHubUpload);

// @ts-ignore
hubRouter.get("/", getHub);

// @ts-ignore
hubRouter.post("/pincode", getCityDetails);

//@ts-ignore
hubRouter.get("/:id", getSpecificHub);

//@ts-ignore
hubRouter.put("/:id", updateHub);

//@ts-ignore
hubRouter.delete("/:id", deleteHub);
export default hubRouter;
