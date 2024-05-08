import { Router } from "express";
import { signup, login, forgotPassword, resetPassword, changePassword } from "../controllers/auth.controller";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/change-password", changePassword);

export default authRouter;