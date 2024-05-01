import { Request } from "express";
import multer from "multer";


const imgStorage = multer.diskStorage({
    // @ts-ignore
  destination: function (req:any, file:any, cb: ()=>void) {
    // @ts-ignore
    cb(null, "uploads/");
  },
//   @ts-ignore
  filename: function (req:Request, file: Object, cb: ()=> void) {
    // @ts-ignore
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const imageStorage = multer({storage: imgStorage})
export {imageStorage}; 