// Shared verbatim with the static frontend's js/phone-validation.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('libphonenumber-js/max'));
  else root.PPATPhone = factory(root.libphonenumber);
})(typeof globalThis === 'object' ? globalThis : this, function (lib) {
  const messages = {
    en: 'Please enter a valid phone number and check the selected country calling code.',
    fr: 'Veuillez saisir un numéro de téléphone valide et vérifier l’indicatif du pays sélectionné.'
  };
  function message(language = 'en') {
    return messages[String(language).toLowerCase().split('-')[0]] || messages.en;
  }
  function normalize(value, country) {
    const selected = country === undefined ? 'US' : country;
    if (typeof selected !== 'string' || !lib.isSupportedCountry(selected)
      || typeof value !== 'string' || value.length > 50 || !/^\+?[0-9\s().-]+$/.test(value.trim())) return null;
    const phone = lib.parsePhoneNumberFromString(value.trim(), { defaultCountry: selected, extract: false });
    if (!phone || phone.ext || !phone.isValid()) return null;
    // Legacy callers sending E.164 without a country remain supported. Explicit
    // country selections must agree, including US/Canada's shared calling code.
    if (country !== undefined && (phone.country ? phone.country !== country
      : phone.countryCallingCode !== lib.getCountryCallingCode(country))) return null;
    return phone.number;
  }
  function detectCountry(value) {
    if (typeof value !== 'string' || !value.trim().startsWith('+') || value.length > 50) return undefined;
    return lib.parsePhoneNumberFromString(value.trim(), { extract: false })?.country;
  }
  return { normalize, detectCountry, message, getCountries: lib.getCountries, getCountryCallingCode: lib.getCountryCallingCode };
});
