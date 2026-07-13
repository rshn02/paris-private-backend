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
    "https://parisprivateairporttransfer.com",
    "https://www.parisprivateairporttransfer.com",
    process.env.CLIENT_URL
  ],
  credentials: true
}));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Paris Private Airport Transfer API is running."
  });
});

app.use("/api/bookings", bookingRoutes);
app.use("/api/confirm", confirmRoutes);
app.use("/api/manage", manageRoutes);
app.use("/api/contact", contactRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});