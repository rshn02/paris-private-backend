const { test } = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../utils/phone.cjs');

for (const [country, value, expected] of [
  ['US', '(202) 555-0123', '+12025550123'],
  ['CA', '+1 (416) 555-0123', '+14165550123'],
  ['FR', '06 12 34 56 78', '+33612345678'],
  ['GB', '07400-123456', '+447400123456'],
  ['FR', '+33 (0)6 12 34 56 78', '+33612345678'],
  ['IT', '02 36618 300', '+390236618300']
]) test(`normalizes ${country}: ${value}`, () => assert.equal(phone.normalize(value, country), expected));

for (const [country, value] of [
  ['FR', '061234567890'], ['US', '202555'], ['FR', '+447400123456'],
  ['FR', '07400123456'], ['US', '+14165550123'], ['CA', '+12025550123'],
  ['FR', '+33 +33 612345678'], ['FR', 'hello 0612345678'], ['GB', '07700900123'],
  ['FR', '+33612345678 ext. 1'], ['XX', '+12025550123'], [null, '+12025550123'],
  ['US', null], ['US', {}], ['US', ''], ['US', '1'.repeat(51)]
]) test(`rejects ${country}: ${JSON.stringify(value)}`, () => assert.equal(phone.normalize(value, country), null));

test('legacy international payloads infer their country without a French fallback', () => {
  assert.equal(phone.normalize('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(phone.normalize('(202) 555-0123'), '+12025550123');
  assert.equal(phone.normalize('0612345678'), null);
});
test('international paste detection distinguishes NANP countries', () => {
  for (const [number, country] of [['+12025550123', 'US'], ['+14165550123', 'CA'], ['+33612345678', 'FR'], ['+447400123456', 'GB']]) {
    assert.equal(phone.detectCountry(number), country);
  }
  assert.equal(phone.detectCountry('+1'), undefined);
});
test('phone errors are localized with English fallback', () => {
  assert.match(phone.message('fr-FR'), /Veuillez/);
  assert.match(phone.message('en-US'), /Please/);
  assert.equal(phone.message('unknown'), phone.message('en'));
});
