import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcrypt";
import { Resend } from "resend";

dotenv.config();

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────
// MIDDLEWARE
// ─────────────────────────────
app.use(express.json());

app.use(cors({
    origin: "lambent-praline-f14246.netlify.app",
    credentials: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none"
}
}));

// ─────────────────────────────
// ADMIN AUTH
// ─────────────────────────────
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;

// LOGIN
app.post("/login", async (req, res) => {
    const { password } = req.body;

    const ok = await bcrypt.compare(password, ADMIN_HASH);

    if (ok) {
        req.session.admin = true;
        return res.json({ success: true });
    }

    res.status(401).json({ success: false });
});

// STATUS
app.get("/admin-status", (req, res) => {
    res.json({ admin: !!req.session.admin });
});

// LOGOUT
app.post("/logout", (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

function requireAdmin(req, res, next) {
    if (!req.session.admin) {
        return res.status(403).json({ error: "Forbidden" });
    }
    next();
}

// ─────────────────────────────
// EMAIL RESERVATION
// ─────────────────────────────
app.post("/api/reservation", async (req, res) => {
    try {
        const data = req.body;

        // EMAIL ADMIN
        await resend.emails.send({
            from: "RM Prestige <onboarding@resend.dev>",
            to: "parisprivateairporttransfer@gmail.com",
            subject: `Nouvelle réservation ${data.ref}`,
            html: `
                <h2>Nouvelle réservation</h2>
                <p><b>Référence :</b> ${data.ref}</p>
                <p><b>Client :</b> ${data.client_name}</p>
                <p><b>Email :</b> ${data.client_email}</p>
                <p><b>Téléphone :</b> ${data.client_phone}</p>
                <hr>
                <p><b>Service :</b> ${data.service}</p>
                <p><b>Départ :</b> ${data.pickup}</p>
                <p><b>Destination :</b> ${data.destination}</p>
                <p><b>Date :</b> ${data.date}</p>
                <p><b>Heure :</b> ${data.time}</p>
                <p><b>Passagers :</b> ${data.passengers}</p>
                <p><b>Bagages :</b> ${data.luggage}</p>
                <p><b>Véhicule :</b> ${data.vehicle}</p>
                <hr>
                <p><b>Total :</b> ${data.total_price}</p>
            `
        });

        // EMAIL CLIENT
        await resend.emails.send({
            from: "RM Prestige <onboarding@resend.dev>",
            to: data.client_email,
            subject: `Confirmation réservation ${data.ref}`,
            html: `
                <h2>Merci pour votre réservation</h2>
                <p>Bonjour ${data.client_name},</p>
                <p>Votre réservation a bien été enregistrée.</p>
                <p><b>Référence :</b> ${data.ref}</p>
                <p><b>Total :</b> ${data.total_price}</p>
                <br>
                <a href="${data.confirm_url}">Confirmer la réservation</a>
            `
        });

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────
// START SERVER
// ─────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});