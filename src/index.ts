import express from "express";
import type { Request, Response } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cluster from "cluster";
import os from "os";
import compression from "compression";
import helmet from "helmet";
import authRouter from "./routes/auth.routes";
import mongoose from "mongoose";
import config from "./utils/config";
import orderRouter from "./routes/order.routes";
import { AuthMiddleware, ErrorHandler } from "./utils/middleware";
import {
  B2BRatecalculatorController,
  addVendors,
  getSellers,
  ratecalculatorController,
} from "./utils/helpers";
import hubRouter from "./routes/hub.routes";
import cors from "cors";
import customerRouter from "./routes/customer.routes";
import morgan from "morgan";
import shipmentRouter from "./routes/shipment.routes";
import sellerRouter from "./routes/seller.routes";
import runCron, { processShiprocketOrders } from "./utils/cronjobs";
import Logger from "./utils/logger";
import adminRouter from "./routes/admin.routes";
import { getSpecificOrder } from "./controllers/order.controller";
import apicache from "apicache";
import path from "path";
import { B2COrderModel } from "./models/order.model";

// Number of CPU cores to use
// const numCPUs = os.cpus().length;
const numCPUs = 1;

// Use in-memory cache
const cache = apicache.middleware;

// Only run server setup in worker processes or if not using cluster
if (!config.USE_CLUSTER || (config.USE_CLUSTER && cluster.isWorker)) {
  const app = express();
  const server = http.createServer(app);
  // const io = new SocketIOServer(server, {
  //   cors: {
  //     origin: "*",
  //     methods: ["GET", "POST"],
  //   },
  //   transports: ["websocket", "polling"],
  //   pingTimeout: 60000,
  //   maxHttpBufferSize: 1e6, // 1MB
  // });

  // Middleware for performance
  app.use(helmet()); // Security headers
  app.use(compression()); // Compress responses
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Static files
  app.use('/api/public', express.static(path.join(__dirname, 'public'), {
    maxAge: 86400000 // 1 day caching
  }));

  // Logging in development only
  if (config.NODE_ENV !== "production") {
    //@ts-ignore
    morgan.token("reqbody", (req, res) => JSON.stringify(req.body));
    app.use(morgan(":method :url :status - :response-time ms - :reqbody"));
  } else {
    app.use(morgan("combined"));
  }

  // Health check endpoint
  app.get("/ping", (_req, res: Response) => {
    return res.send("pong");
  });

  // MongoDB connection
  if (!config.MONGODB_URI) {
    Logger.log("MONGODB_URI doesn't exist: " + config.MONGODB_URI);
    process.exit(0);
  }

  // MongoDB connection options for high performance
  const mongoOptions = {
    maxPoolSize: 100, // Increase connection pool for high traffic
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };

  mongoose
    .connect(config.MONGODB_URI, mongoOptions)
    .then(() => {
      Logger.log("MongoDB connected successfully");
    })
    .catch((err) => {
      Logger.log("MongoDB connection error: " + err.message);
      process.exit(1);
    });

  // API Routes
  app.use("/api/auth", authRouter);
  app.post("/api/vendor", addVendors);
  app.get("/api/getsellers", cache("5 minutes"), getSellers);
  // @ts-ignore
  app.get("/api/order/:awb", getSpecificOrder);

  app.post("/api/shopify", async (req, res) => {
    const order = await B2COrderModel.find({ awb: req.body.awb })
    await processShiprocketOrders(order)
    return res.send("ok");
  });

  // @ts-ignore
  app.post("/api/ratecalculator", AuthMiddleware, ratecalculatorController);
  // @ts-ignore
  app.post("/api/ratecalculator/b2b", AuthMiddleware, B2BRatecalculatorController);
  // @ts-ignore
  app.use("/api/seller", AuthMiddleware, sellerRouter);
  // @ts-ignore
  app.use("/api/customer", AuthMiddleware, customerRouter);
  // @ts-ignore
  app.use("/api/hub", AuthMiddleware, hubRouter);
  // @ts-ignore
  app.use("/api/order", AuthMiddleware, orderRouter);
  // @ts-ignore
  app.use("/api/shipment", AuthMiddleware, shipmentRouter);
  // @ts-ignore
  app.use("/api/admin", adminRouter);

  // WebSocket setup
  // const connectedUsers = new Map(); // In-memory store for connected users

  // io.on("connection", (socket) => {
  //   Logger.log(`New client connected: ${socket.id}`);

  //   // Auth middleware for socket
  //   socket.use(([event, data], next) => {
  //     // Example: token verification can be implemented here
  //     const token = socket.handshake.auth.token;
  //     if (!token && event !== "authenticate") {
  //       return next(new Error("Authentication error"));
  //     }
  //     next();
  //   });

  //   // Handle authentication
  //   socket.on("authenticate", async (data) => {
  //     try {
  //       // Implement your authentication logic here
  //       const userId = "example-user-id"; // Replace with actual auth logic

  //       socket.data.userId = userId;
  //       socket.join(`user:${userId}`);

  //       // Track the user connection
  //       if (!connectedUsers.has(userId)) {
  //         connectedUsers.set(userId, new Set());
  //       }
  //       connectedUsers.get(userId).add(socket.id);

  //       socket.emit("authenticated", { success: true });

  //       // Broadcast user online status if needed
  //       io.emit("user:status", { userId, status: "online" });
  //     } catch (error) {
  //       socket.emit("error", { message: "Authentication failed" });
  //     }
  //   });

  //   // Order status update notification
  //   socket.on("subscribe:orders", () => {
  //     if (socket.data.userId) {
  //       socket.join(`orders:${socket.data.userId}`);
  //       socket.emit("subscribed:orders", { success: true });
  //     }
  //   });

  //   // Disconnect event
  //   socket.on("disconnect", () => {
  //     Logger.log(`Client disconnected: ${socket.id}`);

  //     // Remove user from tracking
  //     if (socket.data.userId) {
  //       const userId = socket.data.userId;
  //       const userSockets = connectedUsers.get(userId);

  //       if (userSockets) {
  //         userSockets.delete(socket.id);

  //         // If no more sockets, user is offline
  //         if (userSockets.size === 0) {
  //           connectedUsers.delete(userId);
  //           io.emit("user:status", { userId, status: "offline" });
  //         }
  //       }
  //     }
  //   });
  // });

  // Notification function to be used throughout the app
  // global.sendNotification = (userId: string, event: string, data: any) => {
  //   io.to(`user:${userId}`).emit(event, data);
  // };

  // // Global notification for order updates
  // global.sendOrderUpdate = (userId: string, orderData: any) => {
  //   io.to(`orders:${userId}`).emit("order:update", orderData);
  // };

  // // Broadcast to all connected clients
  // global.broadcastMessage = (event: string, data: any) => {
  //   io.emit(event, data);
  // };

  // Error handlers
  app.use(ErrorHandler);
  app.use("*", (_req: Request, res: Response) => {
    return res.status(404).send({
      valid: false,
      message: "invalid route",
    });
  });

  // Run cron jobs
  runCron();

  // Start server

  // @ts-ignore
  const PORT = parseInt(config.PORT || "3000", 10);
  server.listen(PORT, () => {
    Logger.log(`Server running on port ${PORT} | Worker ${process.pid}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    Logger.log(`Worker ${process.pid} shutting down...`);
    server.close(() => {
      mongoose.connection.close(false);
      process.exit(0);
    });
  });
}

// Master process - only run if using cluster mode
if (config.USE_CLUSTER && cluster.isPrimary) {
  Logger.log(`Master ${process.pid} is running`);

  // Fork workers based on CPU cores
  for (let i = 0; i < numCPUs; i++) {
    console.log(`CPU idx: ${i}`)
    cluster.fork();
  }

  // Handle worker crashes and restart
  cluster.on("exit", (worker, code, signal) => {
    Logger.log(`Worker ${worker.process.pid} died with code: ${code} and signal: ${signal}`);
    Logger.log("Starting a new worker...");
    cluster.fork();
  });
}

// Add to config.ts:
// USE_CLUSTER: process.env.USE_CLUSTER === "true",
// NODE_ENV: process.env.NODE_ENV || "development",