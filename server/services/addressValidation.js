function addressValidationError(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    return 'Enter a full name, complete street address, city and state.';
  }
  for (const [key, minimum, maximum] of [['fullName', 2, 100], ['addressLine1', 5, 255], ['city', 2, 100], ['state', 2, 100]]) {
    if (typeof address[key] !== 'string' || address[key].trim().length < minimum || address[key].length > maximum) {
      return 'Enter a full name, complete street address, city and state.';
    }
  }
  if (typeof address.phone !== 'string' || !/^[6-9]\d{9}$/.test(address.phone.trim())) return 'Enter a valid 10-digit Indian mobile number.';
  if (typeof address.postalCode !== 'string' || !/^[1-9]\d{5}$/.test(address.postalCode.trim())) return 'Enter a valid 6-digit Indian PIN code.';
  if (address.country && !['india', 'in'].includes(String(address.country).trim().toLowerCase())) return 'Delivery is currently available within India only.';
  for (const [key, max] of [['addressLine2', 255], ['landmark', 255]]) {
    if (address[key] != null && (typeof address[key] !== 'string' || address[key].length > max)) return 'Additional address details must be text up to 255 characters.';
  }
  if (address.addressType != null && (typeof address.addressType !== 'string' || !['Home','Work','Office','Other'].includes(address.addressType))) return 'Select a valid address type.';
  if (address.country != null && (typeof address.country !== 'string' || address.country.length > 100)) return 'Select a valid country.';
  return null;
}

module.exports = addressValidationError;
