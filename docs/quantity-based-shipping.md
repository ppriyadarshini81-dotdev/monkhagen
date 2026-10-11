# Quantity-based Shiprocket packing

Maintain the merchant's packing table in `SHIPROCKET_PACKAGE_PROFILES` in the ignored local `.env`. Runtime code loads `.env` directly and contains the parser and validation only. Weight is actual packed weight in kilograms; length, breadth and height are centimetres. Breadth maps to the spreadsheet's width.

The value is a JSON array of profiles with `minimumQuantity`, `maximumQuantity`, `weight`, `length`, `breadth`, and `height`. `maximumQuantity: null` means an open final tier. An optional `volumetricWeightKg` is a reference value. Use numeric JSON values, cover every quantity starting at one without gaps or overlapping ranges, and restart the backend after changes. Missing or malformed profiles leave automatic packing in `needs_configuration`; complete saved or explicit administrator measurements can still be used.

| Total product units | Weight (kg) | Length (cm) | Breadth (cm) | Height (cm) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0.300 | 27 | 33 | 2.6 |
| 2 | 0.570 | 29.21 | 33.02 | 3.81 |
| 3 | 0.830 | 29.21 | 33.02 | 5.08 |
| 4 | 1.10 | 30.5 | 33.02 | 7.15 |
| 5 or more | 1.45 | 33.02 | 33.02 | 8.90 |

The spreadsheet's “4+” row is interpreted as more than four items, because four has its own row. The final row applies to all quantities of five or more, as supplied; update the configuration with additional tiers if larger parcels need different measurements.

The backend sums saved line quantities, including multiple units of one product and units across different products. Forward orders use all shipment items. Reverse returns use only the requested return quantities. Replacement and rejected-return outbound parcels count both approved replacements and rejected original goods in the consolidated shipment.

For a new forward shipment, the quantity profile takes precedence over the old fixed package environment variables. Explicit administrator measurements override the selected fields, and saved parcel measurements are retained on retries. Existing Shiprocket shipments remain unchanged. `SHIPROCKET_PICKUP_LOCATION` is still required. Production deployments must set `SHIPROCKET_PACKAGE_PROFILES` in their backend environment. No database migration is required.

The spreadsheet volumetric weights are kept as reference values. The API receives actual packed weight and dimensions, matching the [Shiprocket Create Custom Order field contract](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/request/idbyek4/create-custom-order). No extra volumetric-weight field is sent.

Tests verify quantity boundaries, multiple product lines, malformed quantities, admin overrides, persistence/retries, reverse shipments, and mixed/all-rejected inspection parcels. Tests use mocked Shiprocket calls and create no live shipment.
