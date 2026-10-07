// API success is defined by code, not HTTP status or the presence of data.
export function panData(response, operation) {
  if (response?.code !== 0) {
    throw new Error(`${operation}: code=${response?.code ?? 'missing'}, ${response?.message ?? 'invalid response'}`);
  }
  if (response.data == null) throw new Error(`${operation}: success response has no data`);
  return response.data;
}
