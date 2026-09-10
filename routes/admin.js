import express from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

router.get("/session", requireAdmin, (req, res) => {
  res.json({
    success: true,
    user: { id: req.adminUser.id, email: req.adminUser.email || null }
  });
});

export default router;
