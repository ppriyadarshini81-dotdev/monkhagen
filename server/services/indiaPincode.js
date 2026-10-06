const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const cache = new Map();

function key(value) {
  return String(value || '').trim().toLocaleLowerCase('en-IN')
    .replace(/[^a-z0-9]/g, '');
}

const CITY_ALIASES = new Map([
  ['bengaluru', 'bangalore'], ['bangalore', 'bengaluru'],
  ['gurugram', 'gurgaon'], ['gurgaon', 'gurugram'],
  ['mumbai', 'bombay'], ['bombay', 'mumbai'],
  ['kolkata', 'calcutta'], ['calcutta', 'kolkata'],
  ['pune', 'poona'], ['poona', 'pune']
]);

function matchesCity(postOffice, city) {
  const wanted = key(city);
  if (!wanted) return false;
  const candidates = [postOffice?.Name, postOffice?.District, postOffice?.Division, postOffice?.Region]
    .map(key);
  return candidates.some(value => value === wanted || CITY_ALIASES.get(value) === wanted || CITY_ALIASES.get(wanted) === value);
}

function matchesState(postOffice, state) {
  return key(postOffice?.State) === key(state);
}

async function postOfficesFor(pincode, fetchImpl = global.fetch) {
  const cached = cache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) return cached.postOffices;
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('PIN verification is unavailable.'), { status: 503, code: 'PINCODE_VERIFICATION_UNAVAILABLE' });
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`, { signal });
  } catch {
    throw Object.assign(new Error('PIN code could not be verified. Please try again.'), { status: 503, code: 'PINCODE_VERIFICATION_UNAVAILABLE' });
  }
  if (!response.ok) throw Object.assign(new Error('PIN code could not be verified. Please try again.'), { status: 503, code: 'PINCODE_VERIFICATION_UNAVAILABLE' });
  let payload;
  try { payload = await response.json(); }
  catch { throw Object.assign(new Error('PIN code could not be verified. Please try again.'), { status: 503, code: 'PINCODE_VERIFICATION_UNAVAILABLE' }); }
  const postOffices = Array.isArray(payload) && payload[0]?.Status === 'Success' && Array.isArray(payload[0]?.PostOffice)
    ? payload[0].PostOffice : [];
  if (!postOffices.length) throw Object.assign(new Error('Enter a valid Indian PIN code.'), { status: 400, code: 'PINCODE_NOT_FOUND' });
  cache.set(pincode, { postOffices, expiresAt: Date.now() + CACHE_TTL_MS });
  return postOffices;
}

async function lookupPincode(pincode, fetchImpl = global.fetch) {
  const normalized = String(pincode || '').trim();
  if (!/^[1-9]\d{5}$/.test(normalized)) {
    throw Object.assign(new Error('Please enter a valid Indian PIN code.'), { status: 400, code: 'PINCODE_INVALID' });
  }
  const postOffices = await postOfficesFor(normalized, fetchImpl);
  const office = postOffices.find(value => value?.District && value?.State) || postOffices[0];
  return { postalCode: normalized, state: String(office.State || '').trim(), city: String(office.District || office.Name || '').trim(), postOffices };
}

async function assertPincodeMatchesLocation({ postalCode, city, state }, fetchImpl = global.fetch) {
  const pincode = String(postalCode || '').trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) throw Object.assign(new Error('Enter a valid 6-digit Indian PIN code.'), { status: 400, code: 'PINCODE_INVALID' });
  const postOffices = await postOfficesFor(pincode, fetchImpl);
  const matchingState = postOffices.filter(postOffice => matchesState(postOffice, state));
  if (!matchingState.length || !matchingState.some(postOffice => matchesCity(postOffice, city))) {
    throw Object.assign(new Error('This PIN code does not belong to the selected city and state.'), { status: 400, code: 'PINCODE_LOCATION_MISMATCH' });
  }
}

module.exports = { assertPincodeMatchesLocation, lookupPincode, matchesCity, matchesState, postOfficesFor };
