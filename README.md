# Unix-Timestamp-Converter
H5 Unix Timestamp Converter

## Tests

Run `node --test tests/converter.test.cjs` with Node.js 18 or later. No dependencies are required.
The tests exercise the inline conversion and copy handlers, including nanosecond precision and RFC year boundaries.

RFC 2822 requires years of 1900 or later ([section 3.3](https://www.rfc-editor.org/rfc/rfc2822#section-3.3)); RFC 3339 uses four-digit years ([section 5.6](https://www.rfc-editor.org/rfc/rfc3339#section-5.6)). Unsupported formats are explained in the results and excluded from copying; ISO 8601 and Unix timestamps retain the full existing date range.
