import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

export const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM_EMAIL =
  'Paris Private Airport Transfer <booking@parisprivateairporttransfer.com>';

export const REPLY_TO =
  'parisprivateairporttransfer@gmail.com';