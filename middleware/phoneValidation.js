import phone from '../utils/phone.cjs';

export function validatePhoneInput(field) {
  return (req, res, next) => {
    const number = phone.normalize(req.body?.[field], req.body?.phone_country);
    if (!number) {
      const language = req.body?.language || req.get('Accept-Language')?.split(',')[0];
      const message = phone.message(language);
      return res.status(400).json({ success: false, code: 'INVALID_PHONE', field, error: message, message });
    }
    req.body[field] = number;
    next();
  };
}
