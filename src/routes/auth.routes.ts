import { Router } from "express";
import { signup, login, forgotPassword, resetPassword, changePassword, createSubadmin } from "../controllers/auth.controller";
import { AdminAuthMiddleware } from "../utils/middleware";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/change-password", changePassword);
authRouter.post('/create-subadmin', createSubadmin)

export default authRouter;