export const apiUrl = (path: string): string => `${process.env['API_BASE_URL']}${path}`;

export async function fetchOrder(id: string) {
  const res = await fetch(apiUrl(`/v1/orders/${id}`));
  return (await res.json()) as { id: string };
}
