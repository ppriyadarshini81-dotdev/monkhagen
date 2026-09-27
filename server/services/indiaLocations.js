// Offline dataset supplied by @countrystatecity/countries.
// Source: https://github.com/dr5hn/countrystatecity-npm (ODbL-1.0).
const { getStatesOfCountry, getCitiesOfState } = require('@countrystatecity/countries');

const INDIA_CODE = 'IN';
let locationsPromise;

function key(value) {
  return String(value || '').trim().toLocaleLowerCase('en-IN');
}

function uniqueSorted(values) {
  const unique = new Map();
  for (const value of values) {
    const name = String(value || '').trim();
    if (name && !unique.has(key(name))) unique.set(key(name), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'en-IN'));
}

async function loadIndiaLocations() {
  if (!locationsPromise) {
    locationsPromise = getStatesOfCountry(INDIA_CODE).then(async states => {
      const mapped = await Promise.all(states.map(async state => ({
        name: state.name,
        cities: uniqueSorted((await getCitiesOfState(INDIA_CODE, state.iso2)).map(city => city.name))
      })));
      return {
        country: 'India',
        attribution: 'CountryStateCity database (ODbL-1.0)',
        states: mapped.sort((a, b) => a.name.localeCompare(b.name, 'en-IN'))
      };
    }).catch(error => {
      locationsPromise = null;
      throw error;
    });
  }
  return locationsPromise;
}

async function resolveIndiaLocation(stateValue, cityValue) {
  const locations = await loadIndiaLocations();
  const state = locations.states.find(item => key(item.name) === key(stateValue));
  if (!state) return null;
  const city = state.cities.find(item => key(item) === key(cityValue));
  return city ? { state: state.name, city } : null;
}

function sameLocation(left, right) {
  return Boolean(left && right && key(left.state) === key(right.state) && key(left.city) === key(right.city));
}

module.exports = { loadIndiaLocations, resolveIndiaLocation, sameLocation };
