import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import bookingRoutes from "./routes/booking.js";
import confirmRoutes from "./routes/confirm.js";
import manageRoutes from "./routes/manage.js";
import contactRoutes from "./routes/contact.js";

dotenv.config();

const app = express();

app.use(express.json());

app.use(cors({
  origin: [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://parisprivateairporttransfer.com",
    "https://www.parisprivateairporttransfer.com",
    process.env.CLIENT_URL
  ],
  credentials: true
}));

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OK"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});