import { IndiaLocations } from '../models/account.model';

export function locationKey(value: string | null | undefined): string {
  return String(value || '').trim().toLocaleLowerCase('en-IN');
}

export function stateFor(locations: IndiaLocations | null, value: string): { name: string; cities: string[] } | undefined {
  return locations?.states.find(state => locationKey(state.name) === locationKey(value));
}

export function canonicalLocation(locations: IndiaLocations | null, stateValue: string, cityValue: string): { state: string; city: string } | null {
  const state = stateFor(locations, stateValue);
  const city = state?.cities.find(value => locationKey(value) === locationKey(cityValue));
  return state && city ? { state: state.name, city } : null;
}

export function sameLocation(left: { state: string; city: string } | null, right: { state: string; city: string } | null): boolean {
  return Boolean(left && right && locationKey(left.state) === locationKey(right.state) && locationKey(left.city) === locationKey(right.city));
}

export function withLegacyOption(options: string[], legacyValue: string): string[] {
  if (!legacyValue || options.some(value => locationKey(value) === locationKey(legacyValue))) return options;
  return [...options, legacyValue].sort((a, b) => a.localeCompare(b, 'en-IN'));
}
